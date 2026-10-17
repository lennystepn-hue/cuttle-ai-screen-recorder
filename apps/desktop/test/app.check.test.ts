import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
 * The app end to end, its windows never shown: open a project, play, scrub, compare the output view
 * with the export's frames (`cuttle preview`), export. Runs only with `pnpm app:check` (vitest
 * --mode app, after app:build:js and cli:build). CUTTLE_CHECK_SHOTS=<folder> keeps screenshots.
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
  mediaState: { proxy: { state: string }; thumbnails: { state: string }; peaks: { state: string } };
}

const electronPath = (): string => createRequire(import.meta.url)('electron') as unknown as string;

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
  const state = () => editor.evaluate(() => (window as unknown as { __cuttleCheck: { state(): CheckState } }).__cuttleCheck.state());
  const seek = (t: number) => editor.evaluate((time) => (window as unknown as { __cuttleCheck: { seek(t: number): Promise<void> } }).__cuttleCheck.seek(time), t);
  /** A screenshot of the editor (CUTTLE_CHECK_SHOTS): Electron's capturePage, which works on a window never shown. */
  const shot = async (name: string) => {
    if (!SHOTS) return;
    const png = await app.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('/editor.html'))!;
      // A hidden window paints only when asked: repaint, then capture.
      window.webContents.invalidate();
      await new Promise((resolve) => setTimeout(resolve, 250));
      return (await window.webContents.capturePage()).toPNG().toString('base64');
    });
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(png, 'base64'));
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'cuttle-app-'));
    project = join(root, 'demo');
    mkdirSync(project);
    makeFixture(project);
    if (SHOTS) mkdirSync(SHOTS, { recursive: true });
    app = await _electron.launch({
      executablePath: electronPath(),
      args: [MAIN, '--open', project],
      env: { ...process.env, CUTTLE_HIDDEN: '1', CUTTLE_CHECK: '1', CUTTLE_NO_PROXY: '1', CUTTLE_USER_DATA: join(root, 'user-data') },
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
    await app?.close();
    await rm(root, { recursive: true, force: true });
  });

  it('opens the project: the timeline shows its scenes, overlays and markers', async () => {
    expect(await editor.title()).toBe('demo · Cuttle');
    expect(await editor.locator('.scene').count()).toBe(5);
    expect(await editor.locator('.scene').first().getAttribute('title')).toBe('Prompt · 3 s');
    expect(await editor.locator('.item.zoom').count()).toBe(1);
    // the mask (source 0–9) runs across the continuous cut into the 4× clip as one block, then
    // shows again after the jump cut to source 8.5
    expect(await editor.locator('.item.mask').count()).toBe(2);
    // a caption's block shows its label ("Hook"), its text when it has none
    expect(await editor.locator('.item.caption').textContent()).toBe('Hook');
    expect(await editor.locator('.flag').allTextContents()).toEqual(['Prompt', 'Bash ×2', 'Answer']);
    const { duration } = await state();
    expect(duration).toBeCloseTo(3 + 5 / 4 + 3 + 2 + 1.5, 6);
    await shot('01-opened');
  });

  it('shows what the export renders, frame for frame', async () => {
    const stills = join(root, 'stills');
    const times = [1, 4, 6.8, 9.9];
    const result = spawnSync('node', [CLI, '--json', '-C', project, 'preview', ...times.flatMap((t) => ['--at', String(t)]), '-o', stills], { encoding: 'utf8', timeout: 120_000 });
    expect(result.status, result.stderr).toBe(0);
    const files = (JSON.parse(result.stdout) as { stills: { file: string }[] }).stills.map((still) => still.file);
    for (const [i, t] of times.entries()) {
      await seek(t);
      const view = decode(await editor.evaluate(() => (window as unknown as { __cuttleCheck: { pixels(): string } }).__cuttleCheck.pixels()));
      expect([view.width, view.height]).toEqual([FIXTURE_OUTPUT.width, FIXTURE_OUTPUT.height]);
      const { mean, max } = difference(view, PNG.sync.read(readFileSync(files[i]!)));
      expect(mean, `t = ${t}: mean difference`).toBeLessThan(0.5);
      expect(max, `t = ${t}: largest difference`).toBeLessThanOrEqual(24);
    }
    await shot('02-zoom');
  }, 120_000);

  it('plays with the mic as the clock, the picture keeping up, and pauses', async () => {
    await seek(0);
    await editor.keyboard.press('Space');
    await editor.waitForTimeout(2000);
    const playing = await state();
    const stats = await editor.evaluate(() => (window as unknown as { __cuttleCheck: { playback(): { drawn: number; restarts: number; clock: number } } }).__cuttleCheck.playback());
    console.log(`playback after 2 s: clock ${stats.clock.toFixed(2)} s, picture ${playing.t.toFixed(2)} s, ${stats.drawn} frames drawn, ${stats.restarts} restarts`);
    expect(playing.playing).toBe(true);
    // the clock (the sound) runs in real time, from 0.12 s after the key
    expect(stats.clock).toBeGreaterThan(1.5);
    expect(stats.clock).toBeLessThan(2.4);
    // the picture follows it, never more than about half a second behind (then it drops frames)
    expect(stats.clock - playing.t).toBeLessThan(0.7);
    // and plays as a movie, not a slideshow: about 55 frames at 30 fps, at least 25 on a busy machine
    expect(stats.drawn).toBeGreaterThan(25);
    await editor.keyboard.press('Space');
    const paused = await state();
    expect(paused.playing).toBe(false);
    await editor.waitForTimeout(300);
    expect((await state()).t).toBe(paused.t);
  });

  it('scrubs with the playhead on the ruler', async () => {
    const { duration } = await state();
    // A window that is never shown gets no real mouse: the pointer events are dispatched on the ruler's lane.
    await editor.evaluate(() => {
      const lane = document.querySelector('.tl-content')!;
      const box = document.querySelector('[data-testid=timeline]')!.getBoundingClientRect();
      const at = (type: string, x: number) =>
        lane.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: box.left + x, clientY: box.top + 34, button: 0, pointerId: 7 }));
      at('pointerdown', 20);
      for (let step = 1; step <= 8; step++) at('pointermove', 20 + ((box.width / 2 - 20) * step) / 8);
      at('pointerup', box.width / 2);
    });
    await editor.waitForTimeout(500);
    const { t } = await state();
    expect(t).toBeGreaterThan(duration * 0.3);
    expect(t).toBeLessThan(duration * 0.7);
  });

  it('makes the proxy, the thumbnails and the waveform in the background', async () => {
    await editor.waitForFunction(
      () => {
        const media = (window as unknown as { __cuttleCheck: { state(): CheckState } }).__cuttleCheck.state().mediaState;
        return media.proxy.state === 'ready' && media.thumbnails.state === 'ready' && media.peaks.state === 'ready';
      },
      undefined,
      { timeout: 60_000 },
    );
    expect(existsSync(join(project, '.cuttle', 'proxy.mp4'))).toBe(true);
    await editor.waitForSelector('.scene .thumbs i');
    await shot('03-thumbnails');
  }, 90_000);

  it('exports 16:9 into out/ and says where', async () => {
    await editor.keyboard.press('Control+E');
    await editor.waitForSelector('[data-testid=export-sheet]');
    await shot('04-export-sheet');
    await editor.click('[data-testid=export-start]');
    await editor.waitForSelector('[data-testid=export-file]', { timeout: 120_000 });
    await shot('05-exported');
    const out = join(project, 'out', '16x9.mp4');
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout.trim().split(/\r?\n/);
    expect(probe).toEqual(['h264,1920,1080', 'aac']);
    await editor.keyboard.press('Escape');
  }, 150_000);

  it('keeps the pill out of recordings, with the project in its recent list', async () => {
    const pill = app.windows().find((page) => page.url().includes('/pill.html'))!;
    expect(pill).toBeDefined();
    const recent = await pill.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<{ name: string }[]> } }).cuttle.invoke('pill:recent'));
    expect(recent.map((entry) => entry.name)).toEqual(['demo']);
    const editorBridge = await editor.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<unknown> } }).cuttle.invoke('pill:recent').then(() => 'reached', (error: Error) => error.message));
    expect(editorBridge).toContain('unknown request');
  });
});
