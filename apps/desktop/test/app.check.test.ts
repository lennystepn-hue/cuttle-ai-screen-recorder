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
import { parseEventsJsonl, parseProjectJson } from '@cuttle/project';
import { sceneSpans, typingClicks } from '@cuttle/timeline';
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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
  zooms: { id: string; at: number; duration: number; rect: number[]; enabled?: boolean }[];
  masks: { id: string; from: number; to: number; rect: number[]; style?: string; label?: string }[];
  texts: { id: string; text: string; position?: string; at?: number; enabled?: boolean }[];
  annotations?: { id: string; kind: string; at: number; duration: number; rect?: number[]; from?: number[]; to?: number[]; text?: string }[];
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
/** Opens a part of the Look tab: its head opens it, or closes it when it is open already. */
const openLook = (page: Page, part: string) =>
  page.evaluate((part) => {
    const head = document.querySelector(`[data-testid=look-open-${part}]`) as HTMLElement;
    if (head.getAttribute('aria-expanded') !== 'true') head.click();
  }, part);
/**
 * What in the inspector reaches past the right edge of its box (a Look part's card, else the panel
 * inside its padding): a text or a control running out of its panel. Each as its tag, classes and
 * text, with how far it reaches out.
 */
const outsideItsPanel = (page: Page) =>
  page.evaluate(() => {
    const found: string[] = [];
    for (const panel of document.querySelectorAll<HTMLElement>('.inspector .panel-body')) {
      const style = getComputedStyle(panel);
      const panelRight = panel.getBoundingClientRect().left + panel.clientWidth - parseFloat(style.paddingRight);
      for (const element of panel.querySelectorAll<HTMLElement>('*')) {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const card = element.closest('.look-part');
        const right = card && card !== element ? card.getBoundingClientRect().right : panelRight;
        if (rect.right > right + 0.5) found.push(`${element.tagName.toLowerCase()}${[...element.classList].map((name) => `.${name}`).join('')} "${(element.textContent ?? '').trim().slice(0, 40)}" by ${Math.round(rect.right - right)} px`);
      }
    }
    return found;
  });
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

/** Waits for an export to be written; when it is not, the error says what the export sheet shows. */
async function exported(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid=export-file]', { timeout: 120_000 }).catch(async (error: Error) => {
    const sheet = await page.locator('[data-testid=export-sheet]').innerText().catch(() => '(no export sheet)');
    throw new Error(`${error.message}\nThe export sheet says: ${sheet}`);
  });
}

/** The check's update feed (electron-updater's latest.yml, latest-mac.yml): a version far ahead of any. */
const UPDATE_FEED = [
  'version: 99.0.0',
  'files:',
  '  - url: Cuttle-99.0.0-win-x64.exe',
  '    sha512: AAAA',
  '    size: 1',
  '  - url: Cuttle-99.0.0-mac-arm64.zip',
  '    sha512: AAAA',
  '    size: 1',
  'path: Cuttle-99.0.0-win-x64.exe',
  'sha512: AAAA',
  "releaseDate: '2026-10-19T00:00:00.000Z'",
  '',
].join('\n');

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
  const press = (selector: string, moveBy = 0, keys: { shiftKey?: boolean; ctrlKey?: boolean } = {}) =>
    editor.evaluate(
      ({ selector, moveBy, keys }) => {
        const element = document.querySelector(selector)!;
        const box = element.getBoundingClientRect();
        const at = (type: string, x: number) => element.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: box.top + box.height / 2, button: 0, pointerId: 7, ...keys }));
        const x = box.left + Math.min(20, box.width / 2);
        at('pointerdown', x);
        if (moveBy) for (let step = 1; step <= 8; step++) at('pointermove', x + (moveBy * step) / 8);
        at('pointerup', x + moveBy);
      },
      { selector, moveBy, keys },
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
    // what an editor shows here stays inside its inspector, screenshots taken or not
    if (part === '/editor.html') {
      for (const page of app.windows()) {
        if (!page.url().includes(part) || (title !== undefined && (await page.title().catch(() => '')) !== title)) continue;
        expect({ shot: name, outside: await outsideItsPanel(page) }).toEqual({ shot: name, outside: [] });
      }
    }
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
  /** A screenshot of a picker: the window over its display (each display has its own). */
  const shotOfPicker = async (name: string, page: Page) => {
    if (!SHOTS) return;
    const setup = await page.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<{ display: { bounds: { x: number; y: number; width: number; height: number } } }> } }).cuttle.invoke('picker:setup'));
    const { x, y, width, height } = setup.display.bounds;
    const png = await app.evaluate(
      async ({ BrowserWindow }, centre) => {
        const window = BrowserWindow.getAllWindows().find((candidate) => {
          const bounds = candidate.getBounds();
          return candidate.webContents.getURL().includes('/picker.html') && centre.x >= bounds.x && centre.x < bounds.x + bounds.width && centre.y >= bounds.y && centre.y < bounds.y + bounds.height;
        })!;
        window.webContents.invalidate();
        await new Promise((resolve) => setTimeout(resolve, 1600));
        return (await window.webContents.capturePage()).toPNG().toString('base64');
      },
      { x: x + width / 2, y: y + height / 2 },
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
    // The screen is read after a take's cut only where the check asks for it (it says so in the settings),
    // and updates are looked for only when the check asks.
    writeFileSync(join(root, 'user-data', 'settings.json'), JSON.stringify({ projectsFolder: join(root, 'projects'), privacy: { read: false }, updates: false }));
    // the desktop's wallpaper the check gives the app
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720', '-frames:v', '1', join(root, 'wallpaper.png')], { windowsHide: true });
    // the logo the brand's file dialog picks
    writeFileSync(join(root, 'nimbus.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="28" fill="#7C5CFF"/><path d="M34 86V34h12l28 34V34h12v52H74L46 52v34z" fill="#fff"/></svg>');
    models = createServer((request, response) => {
      if (request.url === '/ggml-base.bin' && BASE_MODEL) return void response.end(readFileSync(BASE_MODEL));
      if (request.url === '/ggml-small.bin') return void response.end('not a model');
      // the update feed (asked with ?noCache=…): a version far ahead of this app's (run from the repository it reports Electron's)
      const path = request.url?.split('?')[0];
      if (path === '/updates/latest.yml' || path === '/updates/latest-mac.yml') return void response.end(UPDATE_FEED);
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
        // the brand kits in a folder of the check's own, and the image a file dialog picks
        CUTTLE_BRANDS_DIR: join(root, 'brands'),
        CUTTLE_CHECK_IMAGE: join(root, 'nimbus.svg'),
        // the desktop's wallpaper, the check's own (never this computer's)
        CUTTLE_WALLPAPER: join(root, 'wallpaper.png'),
        // what the spoken test mic says
        CUTTLE_TEST_SPEECH: SPOKEN,
        // the updates' feed, the check's own server (never GitHub)
        CUTTLE_UPDATE_FEED: `http://127.0.0.1:${(models.address() as { port: number }).port}/updates/`,
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

  // A test that failed while a take recorded (its HUD, its windows) would fail the tests after it,
  // which find no new window while it runs: the take is stopped, and the next test waits for its end.
  afterEach(async () => {
    type Host = { recording: boolean; stop(): void };
    const running = () => app.evaluate(() => (globalThis as { __recorder?: Host }).__recorder?.recording ?? false);
    if (!(await running().catch(() => false))) return;
    await app.evaluate(() => (globalThis as { __recorder?: Host }).__recorder?.stop());
    await expect.poll(running, { timeout: 30_000 }).toBe(false);
  });

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
    // the six keys typed at 2.4 s click a second before the clock gets there: every click up to
    // 0.9 s past the clock is set (the schedule looks every 0.1 s), whatever pace the machine kept
    const parsed = parseProjectJson(readFileSync(join(project, 'cuttle.json'), 'utf8'));
    if (!parsed.ok) throw new Error('the demo project does not parse');
    const { events } = parseEventsJsonl(readFileSync(join(project, parsed.project.sources.events!), 'utf8'));
    const clicks = typingClicks(sceneSpans(parsed.project.scenes, parsed.project.cuts), events, parsed.project.look.audio);
    expect(clicks.length).toBe(6);
    expect(stats.clicks).toBeGreaterThanOrEqual(clicks.filter((click) => click.at <= stats.clock + 0.9).length);
    const paused = await state();
    expect(paused.playing).toBe(false);
    await editor.waitForTimeout(300);
    expect((await state()).t).toBe(paused.t);
  }, 30_000);

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
    await exported(editor);
    await shot('06-exported');
    const out = join(project, 'out', 'export.mp4');
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout.trim().split(/\r?\n/);
    expect(probe).toEqual([`h264,${FIXTURE_OUTPUT.width},${FIXTURE_OUTPUT.height}`, 'aac']);
    // again: now it says which export it replaces
    await editor.click('text=Export again');
    await editor.waitForFunction(() => document.querySelector('[data-testid=export-note]')?.textContent?.includes('Replaces out/export.mp4 from'));
    // two formats in one go: both files, each its size, the same sound
    await editor.evaluate(() => [...document.querySelectorAll<HTMLElement>('.format')].find((button) => button.textContent?.includes('9:16'))!.click());
    await editor.waitForFunction(() => document.querySelector('[data-testid=export-note]')?.textContent?.includes('out/9x16.mp4'));
    expect(await editor.locator('[data-testid=export-start]').textContent()).toContain('Export 2 formats');
    await editor.click('[data-testid=export-start]');
    await exported(editor);
    await editor.waitForFunction(() => document.querySelectorAll('[data-testid=export-file]').length === 2);
    const tall = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', join(project, 'out', '9x16.mp4')], { encoding: 'utf8' }).stdout.trim().split(/\r?\n/);
    expect(tall).toEqual(['h264,1080,1920', 'aac']);
    const length = (file: string) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(project, 'out', file)], { encoding: 'utf8' }).stdout.trim());
    expect(length('9x16.mp4')).toBeCloseTo(length('export.mp4'), 1);
    // transparent, for another editor: no background, the window on nothing
    await editor.click('text=Export again');
    await editor.evaluate(() => [...document.querySelectorAll<HTMLElement>('.format')].find((button) => button.textContent?.includes('9:16'))!.click());
    await chooseIn(editor, '[data-testid=export-file-kind]', 'WebM, transparent');
    await editor.waitForFunction(() => document.querySelector('[data-testid=export-note]')?.textContent?.includes('Saves out/export.webm'));
    await editor.click('[data-testid=export-start]');
    await exported(editor);
    const webm = join(project, 'out', 'export.webm');
    expect(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name:stream_tags=alpha_mode', '-of', 'csv=p=0', webm], { encoding: 'utf8' }).stdout.trim().split(/\r?\n/)).toEqual(['vp9,1', 'opus']);
    const rgba = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-c:v', 'libvpx-vp9', '-ss', '1', '-i', webm, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 16 * 1024 * 1024 }).stdout;
    const alphaAt = (x: number, y: number) => rgba[(y * FIXTURE_OUTPUT.width + x) * 4 + 3];
    expect([alphaAt(2, 2), alphaAt(FIXTURE_OUTPUT.width / 2, FIXTURE_OUTPUT.height / 2)]).toEqual([0, 255]);
    await editor.keyboard.press('Escape');
    expect(await editor.locator('[data-testid=export-sheet]').count()).toBe(0);
  }, 150_000);

  it('offers 4K, 60 fps and HEVC in the export sheet, its formats at their 4K sizes', async () => {
    await editor.keyboard.press('Control+E');
    await editor.waitForSelector('[data-testid=export-sheet]');
    await editor.waitForSelector('[data-testid=export-size]');
    // the sheet keeps its choices: the check before exported a transparent WebM
    await chooseIn(editor, '[data-testid=export-file-kind]', 'MP4');
    await chooseIn(editor, '[data-testid=export-size]', '4K');
    await editor.waitForFunction(() => [...document.querySelectorAll('.format')].some((button) => button.textContent?.includes('2160×3840')));
    // the project's own 16:9 too, at 2160 on its short side
    expect(await editor.locator('.format').first().textContent()).toContain('3840×2160');
    await chooseIn(editor, '[data-testid=export-fps]', '60 fps');
    await chooseIn(editor, '[data-testid=export-codec]', 'HEVC, smaller');
    // a transparent file is VP9 or ProRes: no codec to choose then
    await chooseIn(editor, '[data-testid=export-file-kind]', 'WebM, transparent');
    expect(await editor.locator('[data-testid=export-codec]').count()).toBe(0);
    // the sheet keeps its choices: back as they were, for the exports after this one
    await chooseIn(editor, '[data-testid=export-file-kind]', 'MP4');
    await chooseIn(editor, '[data-testid=export-codec]', 'H.264');
    await chooseIn(editor, '[data-testid=export-fps]', `${FIXTURE_OUTPUT.fps} fps, the project's`);
    await chooseIn(editor, '[data-testid=export-size]', 'As the format');
    await editor.keyboard.press('Escape');
  }, 30_000);

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

  it('draws annotations in the source view: a box over what the drag covers, an arrow along it; the inspector sets a callout', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    await seek(1);
    await editor.keyboard.press('a');
    await editor.waitForSelector('[data-testid=source-view]');
    // what the tool draws, picked in the inspector
    await click(editor, '[data-testid=annotate-box]');
    await drag('[data-testid=source-view]', [200, 80], { from: [0.3, 0.3] });
    await savedWhen((file) => (file.annotations?.length ?? 0) === 1);
    const box = onDisk().annotations![0]!;
    expect(box).toMatchObject({ id: 'n1', kind: 'box' });
    expect(box.at).toBeCloseTo(1, 1);
    expect(box.rect![2]! / box.rect![3]!).toBeGreaterThan(1.5);
    await editor.waitForSelector('.source-box.annotation.selected');
    await editor.fill('[data-testid=annotation-text]', 'Look here');
    await editor.press('[data-testid=annotation-text]', 'Enter');
    await savedWhen((file) => file.annotations![0]!.text === 'Look here');
    // an arrow: from where the drag starts to where it ends (the keys are the editor's once the field is left)
    await editor.locator('[data-testid=annotation-text]').blur();
    await editor.keyboard.press('Escape');
    await editor.keyboard.press('a');
    await click(editor, '[data-testid=annotate-arrow]');
    await drag('[data-testid=source-view]', [150, -100], { from: [0.4, 0.7] });
    await savedWhen((file) => file.annotations!.length === 2);
    const arrow = onDisk().annotations![1]!;
    expect(arrow).toMatchObject({ id: 'n2', kind: 'arrow' });
    expect(arrow.to![0]! - arrow.from![0]!).toBeGreaterThan(50);
    expect(arrow.to![1]!).toBeLessThan(arrow.from![1]!);
    await editor.waitForSelector('.source-arrow.selected');
    // its block on the timeline: longer by its end edge, then moved, its points kept (they are not seconds)
    const block = '[data-kind=annotation][data-id=n2]';
    await editor.waitForSelector(`${block} .edge.end`);
    await drag(`${block} .edge.end`, [40, 0]);
    await savedWhen((file) => file.annotations![1]!.duration > arrow.duration + 0.1);
    const longer = onDisk().annotations![1]!;
    await drag(block, [30, 0], { from: [0.4, 0.5] });
    await savedWhen((file) => file.annotations![1]!.at > longer.at + 0.05);
    expect(onDisk().annotations![1]).toMatchObject({ from: arrow.from, to: arrow.to, duration: longer.duration });
    expect((await state()).error).toBeUndefined();
    await shot('08-annotations');
    // the video draws them: no error at the playhead
    await editor.keyboard.press('Escape');
    expect((await state()).error).toBeUndefined();
    await undoAll();
    expect(readFileSync(projectFile(), 'utf8')).toBe(original);
  }, 30_000);

  it('shows the camera in another layout from the Look tab: its lane, its layout in the inspector, drawn as the export draws it', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    type Cameras = { cameras?: { id: string; layout: string; at: number; duration: number }[] };
    const cameras = () => (onDisk() as unknown as Cameras).cameras ?? [];
    await seek(1);
    await click(editor, '#tab-look');
    await openLook(editor, 'camera');
    await editor.waitForSelector('[data-testid=camera-add-side]');
    await click(editor, '[data-testid=camera-add-side]');
    await savedWhen(() => cameras().length === 1);
    expect(cameras()[0]).toMatchObject({ id: 'k1', layout: 'side' });
    expect(cameras()[0]!.at).toBeCloseTo(1, 1);
    // its own lane, and the inspector with it selected
    await editor.waitForSelector('.item.camera');
    await editor.waitForSelector('[data-testid=camera-layout]');
    await chooseIn(editor, '[data-testid=camera-layout]', 'Camera full');
    await savedWhen(() => cameras()[0]?.layout === 'full');
    expect((await doc()).undo).toBe('Camera full there');
    // a second in: the camera over the whole video, as cuttle preview draws it
    await editor.keyboard.press('Escape');
    await editor.evaluate(() => (window as unknown as Hooked).__cuttleCheck.flush());
    const t = cameras()[0]!.at + 1;
    const still = spawnSync('node', [CLI, '--json', '-C', project, 'preview', '--at', String(t), '-o', join(root, 'camera-still')], { encoding: 'utf8', timeout: 120_000 });
    expect(still.status, still.stderr).toBe(0);
    const exported = PNG.sync.read(readFileSync((JSON.parse(still.stdout) as { stills: { file: string }[] }).stills[0]!.file));
    await expect.poll(async () => (await seek(t), difference(await pixels(), exported).mean), { timeout: 20_000, message: 'the camera full: the editor against the export' }).toBeLessThan(2);
    await shot('08-camera-full');
    await undoAll();
    expect(readFileSync(projectFile(), 'utf8')).toBe(original);
  }, 90_000);

  it('puts a colour behind the person in the camera, the segmentation model loaded in the editor as in the export, and draws it as the export does', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    type Behind = { look?: { webcam?: { background?: string } } };
    const behind = () => (onDisk() as unknown as Behind).look?.webcam?.background;
    await seek(1);
    const before = await pixels();
    await click(editor, '#tab-look');
    await openLook(editor, 'camera');
    await editor.waitForSelector('[data-testid=webcam-background]');
    await chooseIn(editor, '[data-testid=webcam-background]', 'A colour');
    await savedWhen(() => behind() === 'color');
    expect((await doc()).undo).toBe('Behind you: a colour');
    // the take's camera shows a test pattern, no person: the whole bubble takes the colour, as cuttle preview draws it
    await editor.evaluate(() => (window as unknown as Hooked).__cuttleCheck.flush());
    const still = spawnSync('node', [CLI, '--json', '-C', project, 'preview', '--at', '1', '-o', join(root, 'behind-still')], { encoding: 'utf8', timeout: 120_000 });
    expect(still.status, still.stderr).toBe(0);
    const exported = PNG.sync.read(readFileSync((JSON.parse(still.stdout) as { stills: { file: string }[] }).stills[0]!.file));
    await expect.poll(async () => (await seek(1), difference(await pixels(), exported).mean), { timeout: 30_000, message: 'the colour behind: the editor against the export' }).toBeLessThan(2);
    // and it is the colour, not the room: the bubble changed from before
    expect(difference(await pixels(), before).mean, 'the bubble against the room as filmed').toBeGreaterThan(0.3);
    await shot('08-camera-behind');
    await undoAll();
    expect(readFileSync(projectFile(), 'utf8')).toBe(original);
  }, 90_000);

  it('animates a caption in and out, picked in the inspector and drawn as the export draws it, and a card’s title', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    type Animated = { texts: { enter?: string; exit?: string }[]; scenes: { type: string; enter?: string }[] };
    const animated = () => onDisk() as unknown as Animated;
    await press('.item.caption');
    await editor.waitForSelector('[data-testid=caption-enter]');
    await chooseIn(editor, '[data-testid=caption-enter]', 'Typewriter');
    await savedWhen(() => animated().texts[0]!.enter === 'typewriter');
    await chooseIn(editor, '[data-testid=caption-exit]', 'Pop');
    await savedWhen(() => animated().texts[0]!.exit === 'pop');
    expect((await doc()).undo).toBe('Caption goes out: pop');
    // a fifth of a second into it, a few letters typed: as cuttle preview draws them
    await editor.keyboard.press('Escape');
    await editor.evaluate(() => (window as unknown as Hooked).__cuttleCheck.flush());
    const still = spawnSync('node', [CLI, '--json', '-C', project, 'preview', '--at', '0.7', '-o', join(root, 'caption-still')], { encoding: 'utf8', timeout: 120_000 });
    expect(still.status, still.stderr).toBe(0);
    const exported = PNG.sync.read(readFileSync((JSON.parse(still.stdout) as { stills: { file: string }[] }).stills[0]!.file));
    await expect.poll(async () => (await seek(0.7), difference(await pixels(), exported).mean), { timeout: 20_000, message: 'the caption typing: the editor against the export' }).toBeLessThan(1.5);
    // the card's title pops in
    await press('.scene[title^="Built with"]');
    await editor.waitForSelector('[data-testid=card-enter]');
    await chooseIn(editor, '[data-testid=card-enter]', 'Pop');
    await savedWhen(() => animated().scenes.find((scene) => scene.type === 'card')?.enter === 'pop');
    await undoAll();
    expect(readFileSync(projectFile(), 'utf8')).toBe(original);
  }, 90_000);

  it('selects several items on the timeline (Shift- and Ctrl-click, a rubber band): moved, switched off and deleted together, each one step to undo', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    const selected = () => editor.locator('.item.selected, .scene.selected').count();
    await press('.item.zoom');
    await press('.item.caption', 0, { shiftKey: true });
    expect(await selected()).toBe(2);
    await editor.waitForSelector('[data-testid=many-details]');
    expect(await editor.locator('[data-testid=many-details] .name').textContent()).toBe('2 items');
    expect(await editor.locator('.many-kinds').textContent()).toBe('1 caption, 1 zoom');
    // one of them dragged: both move by the same time
    await drag('.item.caption', [40, 0]);
    await savedWhen((file) => file.zooms[0]!.at > 8.8 + 0.1 && file.texts[0]!.at! > 0.5 + 0.1);
    const moved = onDisk();
    expect(moved.zooms[0]!.at - 8.8).toBeCloseTo(moved.texts[0]!.at! - 0.5, 3);
    expect((await doc()).undo).toBe('Move 2 items');
    // a Ctrl-click takes one out, and puts it back
    await press('.item.zoom', 0, { ctrlKey: true });
    expect(await selected()).toBe(1);
    await press('.item.zoom', 0, { ctrlKey: true });
    expect(await selected()).toBe(2);
    await click(editor, '[data-testid=many-enabled]');
    await savedWhen((file) => file.zooms[0]!.enabled === false && file.texts[0]!.enabled === false);
    expect((await doc()).undo).toBe('Turn 2 items off');
    await editor.keyboard.press('Delete');
    await savedWhen((file) => file.zooms.length === 0 && file.texts.length === 0);
    expect((await doc()).undo).toBe('Delete 2 items');
    // one step brings both back
    await editor.keyboard.press('Control+Z');
    await savedWhen((file) => file.zooms.length === 1 && file.texts.length === 1);
    // a Shift-drag on the lanes: what the band touches
    await editor.evaluate(() => {
      const content = document.querySelector('.tl-content')!;
      const [caption, zoom] = ['.item.caption', '.item.zoom'].map((selector) => document.querySelector(selector)!.getBoundingClientRect());
      const [from, to] = [{ x: caption!.left + 2, y: Math.min(caption!.top, zoom!.top) + 2 }, { x: zoom!.left + 4, y: Math.max(caption!.bottom, zoom!.bottom) - 2 }];
      const fire = (type: string, x: number, y: number) => (type === 'pointerdown' ? content : window).dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 7, shiftKey: true }));
      fire('pointerdown', from.x, from.y);
      for (let step = 1; step <= 8; step++) fire('pointermove', from.x + ((to.x - from.x) * step) / 8, from.y + ((to.y - from.y) * step) / 8);
      fire('pointerup', to.x, to.y);
    });
    await editor.waitForSelector('.item.caption.selected');
    expect(await editor.locator('.item.zoom.selected').count()).toBe(1);
    expect(await selected()).toBeGreaterThanOrEqual(2);
    await shot('08-multi-select');
    await editor.keyboard.press('Escape');
    expect(await selected()).toBe(0);
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
    await openLook(editor, 'background');
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
    await openLook(editor, 'window');
    await editor.waitForSelector('[data-testid=frame-mac-light] img', { timeout: 20_000 });
    await shot('14-look-swatches');
    await openLook(editor, 'cursor');
    await editor.waitForSelector('[data-testid=cursor-ring] img', { timeout: 20_000 });
    await editor.waitForSelector('[data-testid=cursor-spotlight] img', { timeout: 20_000 });
    await editor.locator('[data-testid=cursor-spotlight]').scrollIntoViewIfNeeded();
    await shot('14b-look-cursors');
    await openLook(editor, 'window');
    await click(editor, '[data-testid=frame-mac-light]');
    await savedWhen((file) => (file as unknown as { look: { frame: { style?: string } } }).look.frame.style === 'mac-light');
    await openLook(editor, 'cursor');
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
    await openLook(editor, 'video');
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

  it("edits a zoom's path: a place picked in the inspector, on the timeline or in the source view moves alone; a move added at the playhead, eased, removed; drawn as the export draws it", async () => {
    const original = readFileSync(projectFile(), 'utf8');
    type Path = { rect: number[]; moves?: { at: number; rect: number[]; ease?: string }[]; auto?: string };
    const path = (file: Written) => file.zooms.find((zoom) => zoom.id === 'z8') as unknown as Path;
    // suggest's typing zoom in the first clip (1×: source seconds are the video's)
    const outside = onDisk() as unknown as { zooms: unknown[] };
    outside.zooms.push({ id: 'z8', label: 'Typing', at: 0.3, duration: 2.5, rect: [100, 100, 576, 360], moves: [{ at: 1.2, rect: [400, 100, 576, 360] }, { at: 2, rect: [600, 300, 576, 360] }], auto: 'typing' });
    writeFileSync(projectFile(), `${JSON.stringify(outside, null, 2)}\n`);
    await editor.waitForSelector('.item.zoom[data-id=z8]');
    await press('.item.zoom[data-id=z8]');
    await editor.waitForSelector('[data-testid=zoom-path-part]');
    expect(await editor.locator('[data-testid^=zoom-place-]').count()).toBe(3);
    // the first move, picked in the inspector: the source view shows it as it is, and its box moves it alone
    await click(editor, '[data-testid=zoom-place-1]');
    await editor.waitForSelector('.zoom-path circle.place.selected');
    await drag('.source-box.selected', [40, 0]);
    await savedWhen((file) => path(file).moves![0]!.rect[0]! > 400);
    const placed = path(onDisk());
    expect([placed.rect[0], placed.moves![1]!.rect[0]]).toEqual([100, 600]);
    expect(placed.auto).toBeUndefined();
    expect((await doc()).undo).toBe("Move the zoom's move 1");
    // the second move's time, dragged on the timeline
    await drag('.item.zoom[data-id=z8] .move-mark.handle[data-place="2"]', [-15, 0]);
    await savedWhen((file) => path(file).moves![1]!.at < 2 - 0.02);
    expect((await doc()).undo).toBe('Move a move of the zoom');
    expect(await editor.locator('[data-testid=zoom-place-2][aria-pressed=true]').count()).toBe(1);
    // the first one's curve: a jump
    await chooseIn(editor, '[data-testid=zoom-move-ease-1]', 'Jump');
    await savedWhen((file) => path(file).moves![0]!.ease === 'jump');
    // a move at the playhead, where the zoom aims there (nothing changes until it is moved), then taken off
    await click(editor, '[data-testid=zoom-place-2]');
    await seek(2.6);
    await click(editor, '[data-testid=zoom-add-move]');
    await savedWhen((file) => path(file).moves!.length === 3);
    expect(path(onDisk()).moves![2]!.at).toBeCloseTo(2.6, 2);
    await editor.waitForSelector('[data-testid=zoom-place-3][aria-pressed=true]');
    await shot('32b-zoom-path');
    await click(editor, '[data-testid=zoom-move-remove-3]');
    await savedWhen((file) => path(file).moves!.length === 2);
    expect((await doc()).undo).toBe('Remove a move of the zoom');
    // just after the jump, the editor draws what cuttle preview draws
    await editor.keyboard.press('Escape');
    await editor.evaluate(() => (window as unknown as Hooked).__cuttleCheck.flush());
    const still = spawnSync('node', [CLI, '--json', '-C', dirname(projectFile()), 'preview', '--at', '1.3', '-o', join(root, 'zoom-path-still')], { encoding: 'utf8', timeout: 120_000 });
    expect(still.status, still.stderr).toBe(0);
    const exported = PNG.sync.read(readFileSync((JSON.parse(still.stdout) as { stills: { file: string }[] }).stills[0]!.file));
    await expect.poll(async () => (await seek(1.3), difference(await pixels(), exported).mean), { timeout: 20_000, message: 'the jump: the editor against the export' }).toBeLessThan(1.5);
    await undoAll();
    writeFileSync(projectFile(), original);
    await editor.waitForFunction(() => document.querySelectorAll('.item.zoom[data-id=z8]').length === 0);
  }, 90_000);

  it('shows a privacy mask that follows text up the screen: its path in the source view, the Auto tab row, Hold still', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    // suggest's mask over a token that scrolled up 200 px from 1 s, followed frame by frame: still at
    // y 500 until 1 s, then 10 px up in each frame
    const outside = onDisk() as unknown as { masks: unknown[] };
    const up = Array.from({ length: 20 }, (_, k) => ({ at: Math.round((1 + (k + 1) / 30) * 1000) / 1000, rect: [300, 490 - 10 * k, 500, 40] }));
    outside.masks.push({ id: 'm8', label: 'Key', from: 0.2, to: 2.8, rect: [300, 500, 500, 40], moves: [{ at: 1, rect: [300, 500, 500, 40] }, ...up], style: 'fill', auto: 'privacy' });
    writeFileSync(projectFile(), `${JSON.stringify(outside, null, 2)}\n`);
    await editor.waitForSelector('.item.mask[data-id=m8] .move-mark');
    await click(editor, '#tab-auto');
    await click(editor, '[data-testid=auto-group-privacy] .auto-toggle');
    await click(editor, '[data-testid=auto-group-privacy] .auto-item');
    await editor.waitForSelector('[data-testid=mask-path]');
    // at the playhead it is where the text was then: at 1.25 s, 80 px up (between two frames' places it covers both)
    const top = async () => {
      const [box, view] = await Promise.all([editor.locator('.source-box.mask.selected').boundingBox(), editor.locator('[data-testid=source-view]').boundingBox()]);
      return ((box!.y - view!.y) / view!.height) * 720;
    };
    await seek(1.25);
    await expect.poll(top).toBeGreaterThan(390);
    expect(await top()).toBeLessThan(440);
    await shot('33a-privacy-mask-path');
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
    // the window takes the pill's width, its margins included (the hotkey is longer on Windows)
    const margins = () => pill.evaluate(() => window.innerWidth - document.querySelector('.pill')!.getBoundingClientRect().width);
    await expect
      .poll(async () => {
        const margin = await margins();
        return margin >= 20 && margin < 21;
      }, { timeout: 10_000 })
      .toBe(true);
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

  it("records again into the same project, with the computer's sound, keeping the first take restorable", async () => {
    const dir = join(root, 'projects', readdirSync(join(root, 'projects'))[0]!);
    const opened = await waitForPage(app, async (page) => page.url().includes('/editor.html') && (await page.title()) !== 'demo · Cuttle');
    await recordThroughPicker(() => click(opened, '[data-testid=record-again]'), { stop: 'none', systemAudio: true });
    const second = await projectWhen(dir, (written) => written.sources.screen === 'takes/2/screen.mp4' && written.scenes[0]?.id !== undefined);
    expect(second.scenes.length).toBeGreaterThan(0);
    // the picker's choice reached the take: the test backend's tone as the computer's sound
    expect(second.sources.system).toBe('takes/2/system.m4a');
    expect(existsSync(join(dir, 'takes', '2', 'system.m4a'))).toBe(true);
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

  it("shows the mic's level in the HUD: its bars rise with the test mic's tone and go dark while paused", async () => {
    const before = new Set(existsSync(join(root, 'projects')) ? readdirSync(join(root, 'projects')) : []);
    await recordThroughPicker(pillRecord, { stop: 'none', camera: undefined, mic: 'Test Microphone' }, false);
    const hud = await runningHud();
    const lit = () => hud.locator('[data-testid=hud-level]').getAttribute('data-level');
    // the test mic's tone is about -21 dBFS: four of the five bars
    await expect.poll(lit, { timeout: 10_000 }).toBe('4');
    // the bars fit the HUD beside the time, the note and the buttons
    expect(await hud.evaluate(() => document.querySelector('.hud')!.scrollWidth <= document.querySelector('.hud')!.clientWidth)).toBe(true);
    await shotOf('31b-hud-level', '/hud.html');
    await click(hud, '[data-testid=hud-pause]');
    await hud.waitForSelector('.hud.paused');
    await expect.poll(lit).toBe('0');
    await click(hud, '[data-testid=hud-pause]');
    await hud.waitForSelector('.hud.recording');
    await expect.poll(lit, { timeout: 10_000 }).toBe('4');
    await click(hud, '[data-testid=hud-stop]');
    const dir = await newProject(before);
    await projectWhen(dir, (written) => written.scenes[0]?.id !== undefined);
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

  it("records with a script: typed in the picker (a pasted list becomes steps), the prompter by the HUD moves on with Next, and the steps become markers and the project's script", async () => {
    const before = new Set(existsSync(join(root, 'projects')) ? readdirSync(join(root, 'projects')) : []);
    await pillRecord();
    const { page } = await firstMonitorPicker();
    await page.evaluate(async () => {
      const bridge = (window as unknown as { cuttle: { invoke(channel: string, argument?: unknown): Promise<unknown> } }).cuttle;
      await bridge.invoke('picker:choices', { stop: 'none' });
      await bridge.invoke('picker:hover');
    });
    await page.waitForSelector('[data-testid=picker-script]');
    expect(await page.locator('[data-testid=picker-script] small').textContent()).toBe('none');
    await click(page, '[data-testid=picker-script]');
    await page.waitForSelector('[data-testid=script-panel]');
    // the first step's title has the focus: typed, and Enter goes on to a new step
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid)).toBe('script-title');
    await page.keyboard.type('Open the settings');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.locator('[data-testid=script-title]').count()).toBe(2);
    // a pasted list becomes steps, an indented line the note of the step above it
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData('text/plain', '2. Turn on dark mode\n   Say that it follows the system.\n3. Export the video');
      document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    const titles = () => page.locator('[data-testid=script-title]').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
    await expect.poll(titles).toEqual(['Open the settings', 'Turn on dark mode', 'Export the video']);
    expect(await page.locator('[data-testid=script-note]').nth(1).inputValue()).toBe('Say that it follows the system.');
    expect(await page.locator('[data-testid=picker-script] small').textContent()).toBe('3 steps');
    await shotOfPicker('46-script', page);
    // Esc closes the panel, not the pick
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid=script-panel]', { state: 'detached' });
    await click(page, '[data-testid=picker-record]').catch(() => {});

    // the prompter: the first step from the countdown on, by the HUD, never in the video, never focused
    const prompter = await waitForPage(app, async (candidate) => candidate.url().includes('/prompter.html') && (await candidate.locator('[data-testid=prompter-title]').textContent()) === 'Open the settings');
    const hud = await runningHud();
    const windows = await app.evaluate(({ BrowserWindow }) => {
      const of = (part: string) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes(part))!;
      const [hud, prompter] = [of('/hud.html'), of('/prompter.html')];
      return { hud: hud.getBounds(), prompter: prompter.getBounds(), isProtected: prompter.isContentProtected(), focusable: prompter.isFocusable() };
    });
    expect(windows).toMatchObject({ isProtected: true, focusable: false, prompter: { x: windows.hud.x, width: windows.hud.width } });
    // right under the HUD, or right over it
    expect([windows.hud.y + windows.hud.height - 10, windows.hud.y - windows.prompter.height + 10]).toContain(windows.prompter.y);
    await prompter.waitForSelector('[data-testid=prompter-next]:not([disabled])');
    expect(await prompter.locator('[data-testid=prompter-count]').textContent()).toBe('Step 1 of 3');
    await wait(800);
    await click(prompter, '[data-testid=prompter-next]');
    // the step goes to the recorder's process and back: under load more than a second
    await expect.poll(() => prompter.locator('[data-testid=prompter-title]').textContent(), { timeout: 5_000 }).toBe('Turn on dark mode');
    expect(await prompter.locator('[data-testid=prompter-count]').textContent()).toBe('Step 2 of 3');
    expect(await prompter.locator('.prompter-note').textContent()).toBe('Say that it follows the system.');
    expect(await prompter.locator('.prompter-then').textContent()).toBe('Then Export the video');
    // the window took its card's height and its margins
    const card = await prompter.locator('[data-testid=prompter]').evaluate((element) => element.getBoundingClientRect().height);
    const prompterHeight = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('/prompter.html'))!.getContentBounds().height);
    await expect.poll(prompterHeight).toBe(Math.ceil(card) + 20);
    // the steps are not the person's markers: the HUD counts none
    expect(await hud.locator('.marker small').count()).toBe(0);
    await shotOf('47-prompter', '/prompter.html');
    // A step's title needs 0.8 s of video after the step. After 0.6 s here step 2 had 1.17 s of it,
    // and a quicker stop left none (macOS's runner); 2 s leaves it room.
    await wait(2000);
    await click(hud, '[data-testid=hud-stop]');

    const dir = await newProject(before);
    const written = (await projectWhen(dir, (file) => file.scenes[0]?.id !== undefined)) as unknown as { script?: unknown };
    expect(written.script).toEqual([
      { id: 'step1', title: 'Open the settings' },
      { id: 'step2', title: 'Turn on dark mode', note: 'Say that it follows the system.' },
      { id: 'step3', title: 'Export the video' },
    ]);
    const { markers } = JSON.parse(readFileSync(join(dir, 'takes', '1', 'markers.json'), 'utf8')) as { markers: { t: number; kind: string; label?: string }[] };
    expect(markers.filter((marker) => marker.kind === 'step').map((marker) => [marker.label, marker.t > 0])).toEqual([
      ['step1', false],
      ['step2', true],
    ]);
    // the editor pins the steps on its timeline by their names
    const opened = await waitForPage(app, async (candidate) => candidate.url().includes('/editor.html') && (await candidate.title()) === `${basename(dir)} · Cuttle`);
    await opened.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
    await expect.poll(() => opened.evaluate(() => (window as unknown as { __cuttleCheck: Check }).__cuttleCheck.doc().undo), { timeout: 15_000 }).toBe("Cuttle's cut");
    await expect.poll(() => opened.locator('.flag span').allTextContents(), { timeout: 15_000 }).toContain('2 · Turn on dark mode');
    await shotOf('47b-step-pins', '/editor.html', `${basename(dir)} · Cuttle`);
    // the cut titled the steps the video shows: a title over step 2, listed in the Auto tab
    const titled = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { texts?: { text: string; auto?: string }[]; scenes: unknown[] };
    // where the steps came and what the cut kept, should it fail
    const facts = JSON.stringify({ steps: markers.filter((marker) => marker.kind === 'step'), scenes: titled.scenes });
    expect(titled.texts?.filter((text) => text.auto === 'title').map((text) => text.text), facts).toContain('Turn on dark mode');
    await click(opened, '#tab-auto');
    await opened.waitForSelector('[data-testid=auto-group-titles]');
    await click(opened, '[data-testid=auto-group-titles] .auto-toggle');
    await shotOf('47c-step-titles', '/editor.html', `${basename(dir)} · Cuttle`);
    await click(opened, '#tab-selection');
    // Record again, once the take is in: the picker opens with the project's script
    await expect.poll(() => opened.locator('[data-testid=project-status]').count(), { timeout: 30_000 }).toBe(0);
    await click(opened, '[data-testid=record-again]');
    const again = await firstMonitorPicker();
    const bridge = (page: Page) => page.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<{ script: { title: string }[] }> } }).cuttle.invoke('picker:setup'));
    expect((await bridge(again.page)).script.map((step) => step.title)).toEqual(['Open the settings', 'Turn on dark mode', 'Export the video']);
    // the pickers close as the pick is cancelled
    await again.page.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<unknown> } }).cuttle.invoke('picker:cancel')).catch(() => {});
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
    // updates, from the check's feed: not looked for by itself (the settings say so), found when asked
    const updateLine = () => settings.locator('[data-testid=updates-line] .row-hint').textContent();
    expect(await updateLine()).toBe('Not looked for a new version yet.');
    expect(await settings.locator('[data-testid=updates-auto]').getAttribute('aria-checked')).toBe('false');
    await click(settings, '[data-testid=updates-check]');
    await expect.poll(updateLine, { timeout: 10_000 }).toBe('Version 99.0.0 is out.');
    expect(await settings.locator('[data-testid=updates-download]').textContent()).toBe('Download version 99.0.0');
    await settings.locator('[data-testid=updates-line]').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await shotOf('49-updates', '/settings.html');
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
    const saved = () => JSON.parse(readFileSync(join(root, 'user-data', 'settings.json'), 'utf8')) as { speech?: { model: string; language: string; live?: boolean } };
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
    // live captions while recording: off until switched on; without a model the row says what they need
    expect(await settings.locator('[data-testid=speech-live]').getAttribute('aria-checked')).toBe('false');
    expect(await settings.locator('.row:has([data-testid=speech-live]) .row-hint').textContent()).toBe('The HUD shows what the mic hears as you speak. It needs a speech model: download one above.');
    await click(settings, '[data-testid=speech-live]');
    await expect.poll(() => saved().speech?.live).toBe(true);
    // the switch shows it before it is pressed again (a press reads the state it shows)
    await settings.waitForSelector('[data-testid=speech-live][aria-checked=true]');
    await click(settings, '[data-testid=speech-live]');
    await expect.poll(() => saved().speech?.live).toBe(false);
    await settings.waitForSelector('[data-testid=speech-live][aria-checked=false]');
    // on again, for the HUD's live captions further on
    await click(settings, '[data-testid=speech-live]');
    await expect.poll(() => saved().speech?.live).toBe(true);
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

  it.runIf(!!BASE_MODEL && hasWhisper)("shows live captions in the HUD while a take with a mic records: the spoken test mic's words, newest at the right", async () => {
    // the fastest model downloaded (the test before downloads it; alone, this one copies it)
    if (!existsSync(join(root, 'models', 'ggml-base.bin'))) {
      mkdirSync(join(root, 'models'), { recursive: true });
      cpSync(BASE_MODEL!, join(root, 'models', 'ggml-base.bin'));
    }
    const before = new Set(existsSync(join(root, 'projects')) ? readdirSync(join(root, 'projects')) : []);
    await recordThroughPicker(pillRecord, { stop: 'none', camera: undefined, mic: 'Spoken Test Microphone' }, false);
    const hud = await runningHud();
    const captions = hud.locator('[data-testid=hud-captions]');
    // "Uh, this is Cuttle. It records your screen…": about two seconds after it is said
    await expect.poll(() => captions.textContent(), { timeout: 45_000 }).toMatch(/\bscreen\b/i);
    // the strip fits under the bar in the HUD's window, the newest word at its right end
    const fits = await hud.evaluate(() => {
      const strip = document.querySelector('.captions')!.getBoundingClientRect();
      const said = document.querySelector('.captions .said')!.getBoundingClientRect();
      const bar = document.querySelector('.hud')!;
      return { inside: strip.bottom <= window.innerHeight && strip.top >= bar.getBoundingClientRect().bottom, newest: said.right <= strip.right, bar: bar.scrollWidth <= bar.clientWidth };
    });
    expect(fits).toEqual({ inside: true, newest: true, bar: true });
    await shotOf('31c-hud-captions', '/hud.html');
    await click(hud, '[data-testid=hud-stop]');
    const dir = await newProject(before);
    const written = await projectWhen(dir, (file) => file.scenes[0]?.id !== undefined);
    expect(written.sources.mic).toBe('takes/1/mic.m4a');
  }, 120_000);

  it('speaks the narration: a recording made elsewhere plays as a line (converted by the media worker); a line written asks for its voice', async () => {
    const dir = join(root, 'narrated');
    makeSpokenFixture(dir, SPOKEN);
    // another tool's voice: the spoken fixture's sound as a file, a line 1 s into the take
    mkdirSync(join(dir, 'audio'), { recursive: true });
    cpSync(join(dir, 'takes', '1', 'mic.m4a'), join(dir, 'audio', 'line.m4a'));
    const path = join(dir, 'cuttle.json');
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    writeFileSync(path, JSON.stringify({ ...raw, voiceover: { lines: [{ id: 'v1', text: 'Cuttle records your screen', at: 1, file: 'audio/line.m4a' }] } }, null, 2));
    const saved = () => JSON.parse(readFileSync(path, 'utf8')) as { voiceover?: { voice?: Record<string, unknown>; lines?: { id: string; text: string }[] } };
    const page = await openEditor(dir);
    await click(page, '#tab-voice');
    // converted and timed in the media worker: the line says how long it is and where it plays
    await expect.poll(() => page.locator('[data-testid=voice-line-v1] em').first().textContent(), { timeout: 60_000 }).toMatch(/^\d+\.\d s · plays at /);
    expect(readdirSync(join(dir, 'voiceover')).filter((name) => name.endsWith('.wav'))).toHaveLength(1);
    // a line added at the playhead brings a voice; written, it is spoken with it, which is not on this computer yet
    await click(page, '[data-testid=voice-add]');
    await page.waitForSelector('[data-testid=voice-text-v2]');
    await page.fill('[data-testid=voice-text-v2]', 'Hello there');
    await page.press('[data-testid=voice-text-v2]', 'Tab');
    await expect.poll(() => saved().voiceover?.lines?.map((line) => [line.id, line.text])).toEqual([
      ['v1', 'Cuttle records your screen'],
      ['v2', 'Hello there'],
    ]);
    expect(saved().voiceover?.voice).toEqual({ provider: 'local', id: 'en_US-amy-medium' });
    await expect.poll(() => page.locator('[data-testid=voice-problem]').textContent(), { timeout: 60_000 }).toContain('not downloaded');
    await page.waitForSelector('[data-testid=voice-download]');
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
    // words selected with Shift are fixed as one phrase with Edit text, and Undo fix brings them back
    expect(await page.locator('[data-testid=transcript-hint]').textContent()).toContain('Double-click a word to correct it');
    await click(page, word('edits'));
    await page.evaluate((selector) => document.querySelector(selector)!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })), word('video'));
    await click(page, '[data-testid=transcript-edit]');
    expect(await page.inputValue('[data-testid=word-field]')).toBe('edits the video');
    await page.fill('[data-testid=word-field]', 'edits your video');
    await page.press('[data-testid=word-field]', 'Enter');
    const [edits, video] = [words[index('edits')]!, words[index('video')]!];
    await expect.poll(() => saved().captions?.fixes).toEqual([
      { at: cuttle.t, end: cuttle.end, text: 'Cuttle!' },
      { at: edits.t, end: video.end, text: 'edits your video' },
    ]);
    await page.waitForSelector(`${word('edits')}.fixed`);
    expect(await page.locator(word('edits')).textContent()).toBe('edits your video ');
    await click(page, word('edits'));
    await click(page, '[data-testid=transcript-unfix]');
    await expect.poll(() => saved().captions?.fixes).toEqual([{ at: cuttle.t, end: cuttle.end, text: 'Cuttle!' }]);
    expect(await page.locator('[data-testid=transcript] .word').count()).toBe(words.length);
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
    await openLook(page, 'subtitles');
    await page.waitForSelector('[data-testid=captions-enabled][aria-checked=true]');
    await chooseIn(page, '[data-testid=captions-style]', 'Karaoke');
    await expect.poll(() => saved().captions?.style).toBe('karaoke');
    await openLook(page, 'sound');
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
    await openLook(page, 'subtitles');
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
    await exported(page);
    expect(await page.locator('[data-testid=export-file] small').textContent()).toContain('with .srt');
    const srt = readFileSync(join(dir, 'out', 'export.srt'), 'utf8');
    expect(srt.startsWith('1\n00:00:00,100 --> ')).toBe(true);
    expect(srt).toContain('Cuttle!');
    // in German too: the sentences to translate from the CLI, each one written, taken in
    await page.keyboard.press('Escape');
    const cli = (...args: string[]) => JSON.parse(spawnSync('node', [CLI, '--json', '-C', dir, ...args], { encoding: 'utf8', timeout: 60_000 }).stdout) as Record<string, unknown>;
    expect(cli('transcript', '--translate', 'de')).toMatchObject({ file: 'subtitles/de.json', language: 'de' });
    const german = JSON.parse(readFileSync(join(dir, 'subtitles', 'de.json'), 'utf8')) as { sentences: { text: string }[] };
    german.sentences.forEach((sentence, i) => (sentence.text = `Übersetzt ${i + 1}`));
    writeFileSync(join(dir, 'subtitles', 'de.json'), JSON.stringify(german));
    expect(cli('captions', 'set', '--translation', 'de')).toMatchObject({ captions: { translations: { de: 'subtitles/de.json' } } });
    // the picture in German, picked in the Look tab
    await page.waitForSelector('[data-testid=captions-language]');
    await chooseIn(page, '[data-testid=captions-language]', 'German (de)');
    await expect.poll(() => (saved().captions as { language?: string } | undefined)?.language).toBe('de');
    // the export writes every language's file
    await page.keyboard.press('Control+E');
    await page.waitForSelector('[data-testid=export-sheet]');
    await page.waitForSelector('[data-testid=export-srt][aria-pressed=true]');
    await click(page, '[data-testid=export-start]');
    await page.waitForFunction(() => document.querySelector('[data-testid=export-file] small')?.textContent?.includes('.srt'), undefined, { timeout: 120_000 });
    expect(readFileSync(join(dir, 'out', 'export.de.srt'), 'utf8')).toContain('Übersetzt 1');
    expect(readFileSync(join(dir, 'out', 'export.srt'), 'utf8')).toContain('Cuttle!');
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
    await exported(page);
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

  it('edits motion in the editor: + Motion adds a template drawn as the export draws it, a param and an edited page show at once, a page that throws says so', async () => {
    const dir = join(root, 'motion-editor');
    makeMotionFixture(dir);
    const page = await openEditor(dir);
    // the hook comes once the first frame is drawn
    await page.waitForFunction(() => '__cuttleCheck' in window);
    type Motion = { status: { item: string; src: string; state: string; errors: string[] }[]; files: number };
    const seekTo = (t: number) => page.evaluate((time) => (window as unknown as Hooked).__cuttleCheck.seek(time), t);
    const view = async () => decode(await page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.pixels()));
    const now = () => page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.state() as CheckState & { motion: Motion });
    const flushPage = () => page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.flush());
    const saved = () => JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { scenes: { type: string; src?: string; params?: Record<string, unknown> }[]; overlays: { id: string }[] };
    const titleAt = 2.2;

    // + Motion: the title after the scene under the playhead, its page copied into motion/, the playhead on it
    await seekTo(0.5);
    await chooseIn(page, '[data-testid=add-motion]', 'Title');
    await expect.poll(() => saved().scenes.map((scene) => scene.src ?? scene.type)).toEqual(['motion/intro/index.html', 'motion/title/index.html', 'clip']);
    expect(existsSync(join(dir, 'motion', 'title', 'index.html'))).toBe(true);
    await expect.poll(async () => (await now()).t).toBe(1);
    // its block on the timeline shows frames of its page
    await page.waitForSelector('.scene.motion .thumbs i', { timeout: 30_000 });
    // the whoosh its page asks for, on the Sound lane where it plays (0.45 s into it), and rendered
    type PageSounds = { sound: { status: { state: string; pageSounds?: { sound: string; at: number; item: string }[] } } };
    const sound = async () => ((await now()) as unknown as PageSounds).sound.status;
    await expect.poll(async () => (await sound()).pageSounds, { timeout: 60_000 }).toEqual([{ sound: 'whoosh', at: 1.45, item: 'Title' }]);
    await page.waitForSelector('[data-testid=page-sound]');
    await expect.poll(async () => (await sound()).state, { timeout: 90_000 }).toBe('ready');

    // the editor draws the scenes and the overlay as the export does (`cuttle preview`), pixel for pixel
    await flushPage();
    const times = [0.5, titleAt, 6];
    const stills = join(root, 'motion-stills');
    const result = spawnSync('node', [CLI, '--json', '-C', dir, 'preview', ...times.flatMap((t) => ['--at', String(t)]), '-o', stills], { encoding: 'utf8', timeout: 120_000 });
    expect(result.status, result.stderr).toBe(0);
    const files = (JSON.parse(result.stdout) as { stills: { file: string }[] }).stills.map((still) => still.file);
    for (const [i, t] of times.entries()) {
      await seekTo(t);
      const { mean, max } = difference(await view(), PNG.sync.read(readFileSync(files[i]!)));
      expect(mean, `t = ${t}: mean difference`).toBeLessThan(0.5);
      expect(max, `t = ${t}: largest difference`).toBeLessThanOrEqual(24);
    }
    expect((await now()).motion.status.map((status) => [status.src, status.state])).toEqual(
      expect.arrayContaining([
        ['motion/title/index.html', 'ready'],
        ['motion/bar/index.html', 'ready'],
      ]),
    );

    // a param, set in the inspector, on the video at once
    await seekTo(titleAt);
    const before = await view();
    await page.fill('[data-testid=param-title]', 'Edited in Cuttle');
    await page.press('[data-testid=param-title]', 'Enter');
    await expect.poll(() => saved().scenes[1]!.params).toEqual({ title: 'Edited in Cuttle' });
    await expect.poll(async () => (await seekTo(titleAt), difference(await view(), before).mean), { timeout: 20_000 }).toBeGreaterThan(1);
    await shotOf('38-motion-editor', '/editor.html', 'motion-editor · Cuttle');

    // Claude edits the page: the editor draws it again
    const changes = (await now()).motion.files;
    const html = join(dir, 'motion', 'title', 'index.html');
    writeFileSync(html, readFileSync(html, 'utf8').replace('</head>', '<style>* { color: #00ff00 !important; }</style></head>'));
    await expect.poll(async () => (await now()).motion.files, { timeout: 10_000 }).toBeGreaterThan(changes);
    const green = (png: PNG) => {
      let count = 0;
      for (let i = 0; i < png.data.length; i += 4) if (png.data[i + 1]! > 200 && png.data[i]! < 90 && png.data[i + 2]! < 90) count++;
      return count;
    };
    await expect.poll(async () => (await seekTo(titleAt), green(await view())), { timeout: 20_000 }).toBeGreaterThan(500);

    // the export has the edited param and the edited page (the param's field gives the keys back first)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Control+E');
    await page.waitForSelector('[data-testid=export-sheet]');
    await page.click('[data-testid=export-start]');
    await exported(page);
    const exportedFrame = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(titleAt), '-i', join(dir, 'out', 'export.mp4'), '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], { windowsHide: true }).stdout;
    expect(green(PNG.sync.read(exportedFrame))).toBeGreaterThan(500);
    await page.keyboard.press('Escape');

    // playing draws the motion frames as they come (the param's field has the keys: the button plays)
    await seekTo(1);
    await click(page, 'button.play');
    await page.waitForTimeout(1500);
    const stats = await page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.playback() as { motion?: { frames: number } });
    expect((await now()).playing).toBe(true);
    await click(page, 'button.play');
    expect(stats.motion?.frames).toBeGreaterThan(5);

    // a page that throws, added from outside: its error in the inspector
    mkdirSync(join(dir, 'motion', 'oops'), { recursive: true });
    writeFileSync(join(dir, 'motion', 'oops', 'index.html'), '<!doctype html><body><script>cuttle.onFrame((t) => { if (t > 0.2) undefinedThing.go(); });</script></body>');
    await flushPage();
    const raw = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8'));
    writeFileSync(join(dir, 'cuttle.json'), `${JSON.stringify({ ...raw, overlays: [...raw.overlays, { id: 'o9', src: 'motion/oops/index.html', at: 1, duration: 2 }] }, null, 2)}\n`);
    await page.waitForSelector('.item.motion[data-id=o9]', { timeout: 20_000 });
    await page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.select({ kind: 'motion', id: 'o9' }));
    await seekTo(6);
    await expect.poll(async () => (await page.locator('[data-testid=motion-errors]').textContent().catch(() => '')) ?? '', { timeout: 20_000 }).toContain('ReferenceError');
    expect(await page.locator('[data-testid=motion-state]').textContent()).toContain('threw an error');
    await shotOf('39-motion-errors', '/editor.html', 'motion-editor · Cuttle');

    // + Motion → Device 3D after the clip: the take plays on its screen, drawn as the export draws it
    await chooseIn(page, '[data-testid=add-motion]', 'Device 3D');
    await expect.poll(() => saved().scenes.map((scene) => scene.src ?? scene.type)).toEqual(['motion/intro/index.html', 'motion/title/index.html', 'clip', 'motion/device-3d/index.html']);
    await expect.poll(async () => (await now()).motion.status.find((status) => status.src === 'motion/device-3d/index.html')?.state, { timeout: 60_000 }).toBe('ready');
    const deviceAt = 12;
    await flushPage();
    const deviceStill = spawnSync('node', [CLI, '--json', '-C', dir, 'preview', '--at', String(deviceAt), '-o', join(root, 'device-stills')], { encoding: 'utf8', timeout: 120_000 });
    expect(deviceStill.status, deviceStill.stderr).toBe(0);
    await seekTo(deviceAt);
    const shown = difference(await view(), PNG.sync.read(readFileSync((JSON.parse(deviceStill.stdout) as { stills: { file: string }[] }).stills[0]!.file)));
    expect(shown.mean, 'the device: mean difference').toBeLessThan(1.5);
    expect((await now()).motion.status.find((status) => status.src === 'motion/device-3d/index.html')?.errors).toEqual([]);
    await shotOf('39b-device-3d', '/editor.html', 'motion-editor · Cuttle');

    // Claude adds a fold into the clip: the clip's panel shows it, its length is set there, and it goes again
    const folded = spawnSync('node', [CLI, '--json', '-C', dir, 'motion', 'new', 'fold', '--into', 's2'], { encoding: 'utf8', timeout: 60_000 });
    expect(folded.status, folded.stderr).toBe(0);
    type Transitioned = { scenes: { id?: string; transition?: { src: string; duration: number } }[] };
    const clipOf = () => (saved() as unknown as Transitioned).scenes.find((scene) => scene.id === 's2');
    await page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.select({ kind: 'scene', id: 's2' }));
    await page.waitForSelector('[data-testid=transition-in]', { timeout: 20_000 });
    await page.fill('[data-testid=transition-duration]', '0.6');
    await page.press('[data-testid=transition-duration]', 'Enter');
    await expect.poll(() => clipOf()?.transition?.duration).toBe(0.6);
    // stopped at the cut: the page's frame, as the export draws it
    const cut = 4.5;
    await flushPage();
    const foldStill = spawnSync('node', [CLI, '--json', '-C', dir, 'preview', '--at', String(cut), '-o', join(root, 'fold-stills')], { encoding: 'utf8', timeout: 120_000 });
    expect(foldStill.status, foldStill.stderr).toBe(0);
    const foldFrame = PNG.sync.read(readFileSync((JSON.parse(foldStill.stdout) as { stills: { file: string }[] }).stills[0]!.file));
    await seekTo(cut);
    await expect.poll(async () => difference(await view(), foldFrame).mean, { timeout: 30_000 }).toBeLessThan(1.5);
    expect((await now()).error).toBeUndefined();
    await shotOf('39c-transition', '/editor.html', 'motion-editor · Cuttle');
    // a moment later its frames are made for playing: playing through the cut shows them
    type Made = { motion?: { made: number }; transitions: number };
    const playback = () => page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.playback() as unknown as Made);
    // 0.6 s at 30 fps, the frame on its very start a crossfade's
    await expect.poll(async () => (await playback()).motion?.made, { timeout: 60_000 }).toBeGreaterThanOrEqual(17);
    await seekTo(4);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await click(page, 'button.play');
    await page.waitForTimeout(1300);
    const played = await playback();
    await click(page, 'button.play');
    expect(played.transitions).toBeGreaterThan(8);
    await click(page, '[data-testid=transition-remove]');
    await expect.poll(() => clipOf()?.transition).toBeUndefined();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'motion-editor · Cuttle')?.close());
  }, 240_000);

  it('plays music made for the video: + Music renders it (its lane, its parts), a param renders it anew, it plays and goes into the export; + Sound puts a sound at the playhead, moved on its lane', async () => {
    const dir = join(root, 'music-editor');
    makeMotionFixture(dir);
    const page = await openEditor(dir);
    await page.waitForFunction(() => '__cuttleCheck' in window);
    type Sound = { status: { state: string; key?: string; info?: { bpm?: number; sections?: unknown[] } | null; stems?: string[]; errors: string[] }; track?: string; seconds: number };
    const seekTo = (t: number) => page.evaluate((time) => (window as unknown as Hooked).__cuttleCheck.seek(time), t);
    const now = () => page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.state() as CheckState & { sound: Sound });
    const saved = () => JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { music?: { src: string; volume?: number; params?: Record<string, unknown> }; sounds?: { id: string; sound: string; at: number; scene?: string }[] };

    // + Music: the template copied into music/, the music set, rendered for the video, its lane and its panel
    await seekTo(0.5);
    await chooseIn(page, '[data-testid=add-music]', 'Pulse');
    await expect.poll(() => saved().music?.src).toBe('music/pulse/index.html');
    expect(existsSync(join(dir, 'music', 'pulse', 'index.html'))).toBe(true);
    // while it renders, its state is a line in the panel and the editor stays in sight (a state's "loading" once took the window's loading cover)
    const rendering = await page.waitForSelector('[data-testid=music-state].loading', { timeout: 30_000 });
    expect((await rendering.boundingBox())!.height).toBeLessThan(60);
    expect(await page.evaluate(() => document.elementFromPoint(innerWidth / 2, 22)?.closest('.titlebar') !== null)).toBe(true);
    await shotOf('40a-music-rendering', '/editor.html', 'music-editor · Cuttle');
    await expect.poll(async () => (await now()).sound.status.state, { timeout: 90_000 }).toBe('ready');
    await expect.poll(async () => (await now()).sound.track, { timeout: 20_000 }).toBe((await now()).sound.status.key);
    const first = (await now()).sound;
    expect(first.status.errors).toEqual([]);
    expect(first.seconds).toBeCloseTo((await now()).duration, 1);
    expect(first.status.info?.bpm).toBeGreaterThanOrEqual(114);
    expect(first.status.info?.sections?.length).toBeGreaterThan(0);
    await page.waitForSelector('[data-testid=music-lane] .music-part');
    expect(await page.locator('[data-testid=music-state]').textContent()).toContain('Ready');
    await shotOf('40-music-editor', '/editor.html', 'music-editor · Cuttle');

    // a param: the music renders again with it
    await page.fill('[data-testid=param-bpm]', '100');
    await page.press('[data-testid=param-bpm]', 'Enter');
    await expect.poll(() => saved().music?.params).toEqual({ bpm: 100 });
    await expect.poll(async () => (await now()).sound.status.info?.bpm, { timeout: 90_000 }).toBe(100);
    await expect.poll(async () => (await now()).sound.track, { timeout: 20_000 }).not.toBe(first.track);
    // its stems in a mixer: the drums off, kept in the project, the music rendered again without them
    expect((await now()).sound.status.stems).toEqual(['drums', 'bass', 'keys', 'pads', 'lead']);
    const withDrums = (await now()).sound.status.key;
    await page.locator('[data-testid=music-stem-drums]').evaluate((element) => {
      const input = element as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '0');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect.poll(() => (saved().music as { stems?: Record<string, number> } | undefined)?.stems).toEqual({ drums: 0 });
    await expect.poll(async () => { const { status } = (await now()).sound; return status.state === 'ready' && status.key !== withDrums; }, { timeout: 90_000 }).toBe(true);

    // it plays with the video: the music and the effects start (the param's field gives the keys back first)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await seekTo(1);
    await click(page, 'button.play');
    await page.waitForTimeout(1200);
    const stats = await page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.playback() as { soundtrack?: number });
    expect((await now()).playing).toBe(true);
    await click(page, 'button.play');
    expect(stats.soundtrack).toBe(2);

    // + Sound at the playhead: on the clip at the source second it shows, its chip on the lane, its panel
    await seekTo(3);
    await chooseIn(page, '[data-testid=add-sound]', 'Whoosh');
    await expect.poll(() => saved().sounds).toEqual([{ id: 'a1', sound: 'whoosh', at: 2 }]);
    const chip = page.locator('.item.sound[data-id=a1]');
    await chip.waitFor();
    expect(await page.locator('[data-testid=sound-volume]').count()).toBe(1);
    // dragged half a second later on its lane, once the chip holds still: the lane comes with the
    // first sound, and right after the chip showed it once had no box (Windows's runner)
    const settled = async () => {
      let last = '';
      for (let tries = 0; tries < 40; tries++) {
        const found = await chip.boundingBox();
        if (found && JSON.stringify(found) === last) return found;
        last = JSON.stringify(found);
        await page.waitForTimeout(100);
      }
      throw new Error(`the sound's chip did not hold still: ${last}`);
    };
    const box = await settled();
    const pps = await page.evaluate(() => (window as unknown as { __cuttleCheck: { pps(): number } }).__cuttleCheck.pps());
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + pps * 0.25, box.y + box.height / 2, { steps: 4 });
    await page.mouse.move(box.x + box.width / 2 + pps * 0.5, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => saved().sounds?.[0]?.at).toBeGreaterThan(2.3);
    // and in the intro (a motion scene): seconds into it
    await seekTo(0.4);
    await chooseIn(page, '[data-testid=add-sound]', 'Pop');
    await expect.poll(() => saved().sounds?.find((sound) => sound.id === 'a2')).toEqual({ id: 'a2', sound: 'pop', at: 0.4, scene: 's1' });
    await expect.poll(async () => (await now()).sound.status.state, { timeout: 90_000 }).toBe('ready');
    await shotOf('41-music-sounds', '/editor.html', 'music-editor · Cuttle');

    // the export has the music (the take has no mic: what is heard is the music and the sounds), at
    // YouTube's loudness, picked in the sheet (and kept in the project)
    await page.keyboard.press('Control+E');
    await page.waitForSelector('[data-testid=export-sheet]');
    await chooseIn(page, '[data-testid=export-loudness]', 'YouTube & social', true);
    await expect.poll(() => (saved() as unknown as { look?: { audio?: { loudness?: string } } }).look?.audio?.loudness).toBe('youtube');
    await page.click('[data-testid=export-start]');
    await exported(page);
    const meter = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', join(dir, 'out', 'export.mp4'), '-map', '0:a', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true }).stderr;
    const summary = meter.slice(meter.lastIndexOf('Summary:'));
    const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]);
    const truePeak = Number(/True peak:\s+Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]);
    expect(Math.abs(lufs + 14), `${lufs} LUFS`).toBeLessThan(1);
    expect(truePeak, `${truePeak} dBTP`).toBeLessThanOrEqual(-1);
    expect(await page.locator('[data-testid=export-file]').textContent()).toContain('LUFS');
    await page.keyboard.press('Escape');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'music-editor · Cuttle')?.close());
  }, 300_000);

  it('sets the brand in the Look tab and saves it as a kit; another project wears the kit with one click, its end card as the first one’s, as the export draws it', async () => {
    const brands = join(root, 'brands');
    type Branded = { theme?: Record<string, unknown>; look: { background?: { preset: string }; frame?: { style?: string }; cursor?: { style?: string; color?: string } }; scenes: { type: string; src?: string }[] };
    const saved = (dir: string) => JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as Branded;
    const hooks = (page: Page) => ({
      seek: (t: number) => page.evaluate((time) => (window as unknown as Hooked).__cuttleCheck.seek(time), t),
      view: async () => decode(await page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.pixels())),
      state: () => page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.state() as CheckState & { motion: { status: { src: string; state: string; errors: string[] }[] } }),
    });
    /** A project with an end card after its clip, open, its brand part open in the Look tab. */
    const endCard = async (name: string) => {
      const dir = join(root, name);
      makeMotionFixture(dir);
      const page = await openEditor(dir);
      await page.waitForFunction(() => '__cuttleCheck' in window);
      await hooks(page).seek(5.5);
      await chooseIn(page, '[data-testid=add-motion]', 'End card');
      await expect.poll(() => saved(dir).scenes.map((scene) => scene.src ?? scene.type)).toEqual(['motion/intro/index.html', 'clip', 'motion/end-card/index.html']);
      await click(page, '#tab-look');
      await openLook(page, 'brand');
      await page.waitForSelector('[data-testid=brand-name]');
      return { dir, page, ...hooks(page) };
    };
    // the end card settled: the mark landed, the URL typed, the call to action in
    const cardAt = 9.4;
    const settled = async (one: Awaited<ReturnType<typeof endCard>>) => {
      await expect.poll(async () => (await one.state()).motion.status.find((status) => status.src === 'motion/end-card/index.html')?.state, { timeout: 60_000 }).toBe('ready');
      await one.seek(cardAt);
      return one.view();
    };

    // the first project: the brand set in the Look tab (a logo from a file, a font, an accent), the background its own
    const first = await endCard('brand-first');
    await first.page.fill('[data-testid=brand-name]', 'Nimbus');
    await first.page.press('[data-testid=brand-name]', 'Enter');
    await first.page.fill('[data-testid=brand-url]', 'nimbus.app');
    await first.page.press('[data-testid=brand-url]', 'Enter');
    await click(first.page, '[data-testid=brand-logo]');
    await chooseIn(first.page, '[data-testid=brand-font]', 'Bebas Neue');
    await first.page.evaluate(() => {
      const input = document.querySelector('input[aria-label="Accent colour"]') as HTMLInputElement;
      input.value = '#7c5cff';
      input.dispatchEvent(new Event('change'));
    });
    await openLook(first.page, 'background');
    await click(first.page, '.swatch-button.bg-mesh');
    await expect.poll(() => saved(first.dir).theme, { timeout: 10_000 }).toEqual({ name: 'Nimbus', url: 'nimbus.app', logo: 'brand/nimbus.svg', font: 'Bebas Neue', accent: '#7C5CFF' });
    expect(readFileSync(join(first.dir, 'brand', 'nimbus.svg'), 'utf8')).toContain('<svg');
    // the end card wears it: the logo, the name's font, the URL, the accent; the editor draws it as `cuttle preview` does
    const firstCard = await settled(first);
    // the logo is there (the brand's accent fills it; a logo that did not load leaves its place empty)
    const accentPixels = (png: PNG) => {
      let count = 0;
      for (let i = 0; i < png.data.length; i += 4) if (Math.abs(png.data[i]! - 0x7c) + Math.abs(png.data[i + 1]! - 0x5c) + Math.abs(png.data[i + 2]! - 0xff) < 40) count++;
      return count;
    };
    expect(accentPixels(firstCard), 'the logo').toBeGreaterThan(400);
    await first.page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.flush());
    const still = spawnSync('node', [CLI, '--json', '-C', first.dir, 'preview', '--at', String(cardAt), '-o', join(root, 'brand-stills')], { encoding: 'utf8', timeout: 120_000 });
    expect(still.status, still.stderr).toBe(0);
    const exportCard = PNG.sync.read(readFileSync((JSON.parse(still.stdout) as { stills: { file: string }[] }).stills[0]!.file));
    const drawn = difference(firstCard, exportCard);
    expect(drawn.mean, 'the end card: mean difference').toBeLessThan(0.5);
    expect((await first.state()).motion.status.find((status) => status.src === 'motion/end-card/index.html')?.errors).toEqual([]);
    // saved as a kit, under the brand's name: its files beside it, and the project wears it
    await openLook(first.page, 'brand');
    await first.page.waitForSelector('[data-testid=brand-save]:not([disabled])');
    await click(first.page, '[data-testid=brand-save]');
    // saving and applying a kit copies its files first: a busy runner takes seconds
    await expect.poll(() => existsSync(join(brands, 'nimbus', 'brand.json')), { timeout: 10_000 }).toBe(true);
    expect(readdirSync(join(brands, 'nimbus')).sort()).toEqual(['brand.json', 'logo.svg']);
    await expect.poll(() => saved(first.dir).theme?.kit, { timeout: 10_000 }).toBe('Nimbus');
    await first.page.waitForSelector('[data-testid=brand-kit][aria-pressed=true]');
    await shotOf('42-brand', '/editor.html', 'brand-first · Cuttle');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'brand-first · Cuttle')?.close());

    // another project: the kit is one click; its end card is the first one's; undo takes it all back as one step
    const second = await endCard('brand-second');
    await second.page.waitForSelector('[data-testid=brand-kit]');
    await click(second.page, '[data-testid=brand-kit]');
    await expect.poll(() => saved(second.dir).theme, { timeout: 10_000 }).toEqual({ name: 'Nimbus', url: 'nimbus.app', logo: 'brand/nimbus-logo.svg', foreground: '#FFFFFF', font: 'Bebas Neue', accent: '#7C5CFF', kit: 'Nimbus' });
    expect(saved(second.dir).look).toMatchObject({ background: { preset: 'mesh' }, frame: { style: 'mac-dark' }, cursor: { style: 'system', color: '#D97757' } });
    expect(existsSync(join(second.dir, 'brand', 'nimbus-logo.svg'))).toBe(true);
    // the page may still say ready from its render before the kit: the card as it comes, until it matches
    await expect.poll(async () => difference(await settled(second), firstCard).mean, { timeout: 30_000, message: 'the second end card against the first' }).toBeLessThan(0.5);
    await shotOf('42b-brand-applied', '/editor.html', 'brand-second · Cuttle');
    await second.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await second.page.keyboard.press('Control+Z');
    await expect.poll(() => saved(second.dir).theme).toBeUndefined();
    expect(saved(second.dir).look.background).toBeUndefined();
    await second.page.keyboard.press('Control+Shift+Z');
    await expect.poll(() => saved(second.dir).theme?.kit).toBe('Nimbus');
    // a kit is removed after a question; the project keeps what it set
    await click(second.page, '.kit-remove');
    await second.page.waitForSelector('.kit-confirm');
    await click(second.page, '.kit-confirm .primary');
    await expect.poll(() => existsSync(join(brands, 'nimbus'))).toBe(false);
    await second.page.waitForSelector('[data-testid=brand-kit]', { state: 'detached' });
    expect(saved(second.dir).theme?.kit).toBe('Nimbus');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'brand-second · Cuttle')?.close());
  }, 240_000);

  it('builds a gradient in the Look tab from the take’s colours, puts the desktop’s wallpaper behind the window, softened and darker, and draws the quiet ones as the export does', async () => {
    const dir = join(root, 'backgrounds');
    makeFixture(dir);
    const page = await openEditor(dir);
    await page.waitForFunction(() => '__cuttleCheck' in window);
    const seekTo = (t: number) => page.evaluate((time) => (window as unknown as Hooked).__cuttleCheck.seek(time), t);
    const view = async () => decode(await page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.pixels()));
    type Background = { preset: string; colors?: string[]; angle?: number; kind?: string; image?: string; blur?: number; dim?: number };
    const saved = () => (JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { look: { background: Background } }).look.background;
    /** The editor's frame at `t` against `cuttle preview`'s (the window over the background, in the first clip). */
    const asExported = async (t: number, name: string) => {
      await page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.flush());
      const still = spawnSync('node', [CLI, '--json', '-C', dir, 'preview', '--at', String(t), '-o', join(root, `bg-${name}`)], { encoding: 'utf8', timeout: 120_000 });
      expect(still.status, still.stderr).toBe(0);
      const exported = PNG.sync.read(readFileSync((JSON.parse(still.stdout) as { stills: { file: string }[] }).stills[0]!.file));
      await expect.poll(async () => (await seekTo(t), difference(await view(), exported).mean), { timeout: 20_000, message: `${name}: the editor against the export` }).toBeLessThan(0.6);
    };
    const setRange = (testId: string, value: number) =>
      page.locator(`[data-testid=${testId}]`).evaluate((element, to) => {
        const input = element as HTMLInputElement;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(to));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
    await click(page, '#tab-look');
    await openLook(page, 'background');

    // a gradient: its own colours first, then the take's, a third stop, an angle, then radial
    await click(page, '[data-testid=bg-gradient]');
    await expect.poll(saved).toEqual({ preset: 'gradient', colors: ['#7C5CFF', '#FF7AB6'] });
    await click(page, '[data-testid=bg-from-take]');
    await expect.poll(() => saved().colors, { timeout: 30_000 }).not.toEqual(['#7C5CFF', '#FF7AB6']);
    const taken = saved().colors!;
    expect(taken.length).toBeGreaterThanOrEqual(2);
    if (taken.length < 4) {
      await click(page, '[data-testid=bg-color-add]');
      await expect.poll(() => saved().colors?.length).toBe(taken.length + 1);
    }
    await page.fill('[data-testid=bg-angle]', '90');
    await page.press('[data-testid=bg-angle]', 'Enter');
    await expect.poll(() => saved().angle).toBe(90);
    await asExported(1, 'gradient');
    await shotOf('43-background-gradient', '/editor.html', 'backgrounds · Cuttle');
    await click(page, '[data-testid=bg-radial]');
    await expect.poll(() => saved().kind).toBe('radial');
    await asExported(1, 'radial');

    // the desktop's wallpaper (the check's own), softened; then darker
    await click(page, '[data-testid=bg-wallpaper]');
    await expect.poll(saved).toEqual({ preset: 'image', image: 'images/wallpaper.png', blur: 0.6 });
    expect(existsSync(join(dir, 'images', 'wallpaper.png'))).toBe(true);
    await page.waitForSelector('[data-testid=bg-dim]');
    await setRange('bg-dim', 30);
    await expect.poll(() => saved().dim).toBe(0.3);
    await asExported(1, 'wallpaper');
    await shotOf('43b-background-wallpaper', '/editor.html', 'backgrounds · Cuttle');

    // the quiet ones, each as the export draws it; flow in the gradient's colours (they stay)
    await click(page, '[data-testid=bg-flow]');
    await expect.poll(saved).toEqual({ preset: 'flow' });
    for (const preset of ['flow', 'bokeh', 'dots']) {
      await click(page, `[data-testid=bg-${preset}]`);
      await expect.poll(() => saved().preset).toBe(preset);
      await asExported(1, preset);
      if (preset === 'dots') await shotOf('43c-background-dots', '/editor.html', 'backgrounds · Cuttle');
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'backgrounds · Cuttle')?.close());
  }, 240_000);

  it('frames the take as Windows, a terminal or a phone and puts a watermark in a corner (its text, then an image), each as the export draws it', async () => {
    const dir = join(root, 'frames');
    makeFixture(dir);
    const page = await openEditor(dir);
    await page.waitForFunction(() => '__cuttleCheck' in window);
    const seekTo = (t: number) => page.evaluate((time) => (window as unknown as Hooked).__cuttleCheck.seek(time), t);
    const view = async () => decode(await page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.pixels()));
    type Look = { frame?: { style?: string }; watermark?: { enabled?: boolean; text?: string; image?: string; corner?: string; size?: number } };
    const saved = () => (JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { look: Look }).look;
    const asExported = async (t: number, name: string) => {
      await page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.flush());
      const still = spawnSync('node', [CLI, '--json', '-C', dir, 'preview', '--at', String(t), '-o', join(root, `frame-${name}`)], { encoding: 'utf8', timeout: 120_000 });
      expect(still.status, still.stderr).toBe(0);
      const exported = PNG.sync.read(readFileSync((JSON.parse(still.stdout) as { stills: { file: string }[] }).stills[0]!.file));
      await expect.poll(async () => (await seekTo(t), difference(await view(), exported).mean), { timeout: 20_000, message: `${name}: the editor against the export` }).toBeLessThan(0.6);
    };
    await click(page, '#tab-look');

    // the frames: the engine's own pictures of each, then three of them on the take
    await openLook(page, 'window');
    await page.waitForSelector('[data-testid=frame-iphone] img', { timeout: 20_000 });
    await page.locator('[data-testid=frame-iphone]').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await shotOf('44-frames', '/editor.html', 'frames · Cuttle');
    for (const style of ['windows-dark', 'terminal', 'iphone']) {
      await click(page, `[data-testid=frame-${style}]`);
      await expect.poll(() => saved().frame?.style).toBe(style);
      await asExported(1, style);
    }

    // the watermark: on, its text (the project has no logo and no name), then an image, top left and larger
    await openLook(page, 'watermark');
    await click(page, '[data-testid=watermark-enabled]');
    await expect.poll(() => saved().watermark?.enabled).toBe(true);
    await page.fill('[data-testid=watermark-text]', 'nimbus.app');
    await page.press('[data-testid=watermark-text]', 'Enter');
    await expect.poll(() => saved().watermark?.text).toBe('nimbus.app');
    await asExported(1, 'watermark-text');
    // the image comes through the file dialog and is copied into the project before the edit is saved:
    // more than the poll's default second on a busy runner
    await click(page, '[data-testid=watermark-image]');
    await expect.poll(() => saved().watermark?.image, { timeout: 10_000 }).toBe('images/nimbus.svg');
    await click(page, '[data-testid=watermark-top-left]');
    await page.locator('[data-testid=watermark-size]').evaluate((element) => {
      const input = element as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '12');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect.poll(() => saved().watermark).toMatchObject({ corner: 'top-left', size: 0.12 });
    await asExported(1, 'watermark-image');
    await shotOf('44b-watermark', '/editor.html', 'frames · Cuttle');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'frames · Cuttle')?.close());
  }, 240_000);

  it('keeps every part of the Look tab inside the inspector, each with all its rows shown', async () => {
    const dir = join(root, 'looks');
    makeFixture(dir);
    // a transcript and a clean voice, so the subtitles' and the sound's rows all show; a watermark on
    const take = join(dir, 'takes', '1');
    writeFileSync(join(take, 'transcript.json'), JSON.stringify({ version: 1, language: 'en', model: 'small', words: [{ t: 1, end: 1.4, text: 'Hello' }] }));
    cpSync(join(take, 'mic.m4a'), join(take, 'mic.clean.m4a'));
    const path = join(dir, 'cuttle.json');
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { sources: Record<string, string>; look: Record<string, unknown> };
    raw.sources = { ...raw.sources, transcript: 'takes/1/transcript.json', cleanMic: 'takes/1/mic.clean.m4a' };
    raw.look = { ...raw.look, watermark: { enabled: true } };
    writeFileSync(path, JSON.stringify(raw, null, 2));
    const page = await openEditor(dir);
    await click(page, '#tab-look');
    const parts = await page.$$eval('.look-part', (sections) => sections.map((section) => (section as HTMLElement).dataset.testid!.replace(/^look-/, '')));
    expect(parts).toEqual(['brand', 'watermark', 'background', 'window', 'cursor', 'keys', 'camera', 'subtitles', 'sound', 'video']);
    const outside: Record<string, string[]> = {};
    const look = async (part: string) => {
      const found = await outsideItsPanel(page);
      if (found.length > 0) outside[part] = found;
    };
    await look('closed');
    for (const part of parts) {
      await openLook(page, part);
      await page.waitForSelector(`[data-testid=look-${part}] .look-body`);
      // a moment for what a part loads (the frames' and cursors' pictures, the kits)
      await page.waitForTimeout(400);
      await look(part);
    }
    expect(outside).toEqual({});
    await openLook(page, 'sound');
    await shotOf('45-sound', '/editor.html', 'looks · Cuttle');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'looks · Cuttle')?.close());
  }, 120_000);

  it("exports the script's steps as the video's chapters, and lists them to copy for a YouTube description", async () => {
    const dir = join(root, 'chapters');
    makeFixture(dir);
    // the take reached the steps at 0, 2 and 9 s: the video shows 9 s at 4.125 s (after 3 s at 1× and 5 s at 8×)
    writeFileSync(join(dir, 'takes', '1', 'markers.json'), JSON.stringify({ version: 1, markers: [{ t: 0, kind: 'step', label: 'step1' }, { t: 2, kind: 'step', label: 'step2' }, { t: 9, kind: 'step', label: 'step3' }] }));
    const path = join(dir, 'cuttle.json');
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), script: [{ id: 'step1', title: 'Open the settings' }, { id: 'step2', title: 'Turn on dark mode' }, { id: 'step3', title: 'Export the video' }] }));
    const page = await openEditor(dir);
    await page.keyboard.press('Control+E');
    await page.waitForSelector('[data-testid=export-chapters]');
    expect(await page.locator('[data-testid=export-chapters] span').textContent()).toBe('3 from the script, in the video file');
    await page.waitForSelector('[data-testid=export-start]:not([disabled])');
    await click(page, '[data-testid=export-start]');
    await exported(page);
    expect(await page.locator('[data-testid=export-file] small').textContent()).toContain('· 3 chapters');
    const list = '0:00 Open the settings\n0:02 Turn on dark mode\n0:04 Export the video';
    expect(await page.locator('[data-testid=export-chapter-list] pre').textContent()).toBe(list);
    // a video this short: YouTube would not show them, and says why
    expect(await page.locator('[data-testid=export-chapter-list] .note').textContent()).toMatch(/^YouTube needs each chapter to last 10 s or more/);
    await click(page, '[data-testid=export-copy-chapters]');
    await expect.poll(() => page.locator('[data-testid=export-copy-chapters]').textContent()).toBe('Copied');
    expect(await app.evaluate(() => (globalThis as { __copied?: string }).__copied)).toBe(list);
    await shotOf('48-export-chapters', '/editor.html', 'chapters · Cuttle');
    // the video file has them, where the take reached each step
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', join(dir, 'out', 'export.mp4')], { encoding: 'utf8' });
    const chapters = (JSON.parse(probe.stdout) as { chapters: { start_time: string; tags: { title: string } }[] }).chapters;
    expect(chapters.map((chapter) => [Number(chapter.start_time), chapter.tags.title])).toEqual([
      [0, 'Open the settings'],
      [2, 'Turn on dark mode'],
      [4.125, 'Export the video'],
    ]);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'chapters · Cuttle')?.close());
  }, 180_000);

  // late in the check: the project it opens joins the recent list the pill's check counts
  it('opens the project the cuttle command names (cuttle open): a second launch hands it to the running app; a video without a recording opens', async () => {
    const reel = join(root, 'reel');
    for (const argv of [['init', reel], ['-C', reel, 'motion', 'new', 'title', '--first']]) {
      expect(spawnSync('node', [CLI, '--json', ...argv], { encoding: 'utf8', timeout: 60_000 }).status).toBe(0);
    }
    // the second launch shares the check's user data, where the lock of the one running app is
    const opened = spawnSync('node', [CLI, '--json', '-C', reel, 'open'], {
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, CUTTLE_APP: MAIN, CUTTLE_USER_DATA: join(root, 'user-data'), CUTTLE_HIDDEN: '1' },
    });
    expect(opened.status, opened.stdout + opened.stderr).toBe(0);
    expect(JSON.parse(opened.stdout)).toEqual({ dir: reel, app: MAIN });
    await expect.poll(editorTitles, { timeout: 30_000 }).toContain('reel · Cuttle');
    // the project has no take (a video written in code): the editor opens it all the same, and plays its page
    const page = await waitForPage(
      app,
      async (candidate) =>
        candidate.url().includes('/editor.html') &&
        basename((await candidate.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<{ dir: string }> } }).cuttle.invoke('project:info'))).dir) === 'reel',
    );
    await page.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
    expect(await page.locator('.project-name span').textContent()).toContain('no recording');
    expect(await page.locator('.scene').count()).toBe(1);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'reel · Cuttle')?.close());
  });

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
