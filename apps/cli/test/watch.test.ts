import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseProject } from '@cuttle/project';
import { afterAll, describe, expect, it } from 'vitest';
import { runsFor, watchCommand, type WatchRun, type WatchUpdate } from '../src/commands/watch';
import { createOutput } from '../src/output';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

const parsed = parseProject({
  version: 1,
  sources: { screen: 'takes/1/screen.mp4' },
  scenes: [
    { type: 'motion', id: 's1', src: 'motion/title/index.html', duration: 2, transition: { src: 'motion/fold/index.html' } },
    { type: 'motion', id: 's2', src: 'motion/chart.html', duration: 2 },
  ],
  overlays: [],
  music: { src: 'music/score/index.html' },
});
if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
const project = parsed.project;

describe('runsFor', () => {
  it("reruns the check of the page a file belongs to, the music's, else the preview, and nothing for Cuttle's own files", () => {
    const strip = (runs: ReturnType<typeof runsFor>) => runs.map(({ files, ...run }) => [run, files]);
    expect(strip(runsFor(['motion/title/index.html', 'motion/title/logo.svg', 'motion/fold/index.html'], project))).toEqual([
      [{ check: 'motion', src: 'motion/title/index.html' }, ['motion/title/index.html', 'motion/title/logo.svg']],
      [{ check: 'motion', src: 'motion/fold/index.html' }, ['motion/fold/index.html']],
    ]);
    // a page alone in motion/ is just its file; the folder's other files are the preview's
    expect(strip(runsFor(['motion/chart.html', 'motion/other.css'], project))).toEqual([
      [{ check: 'motion', src: 'motion/chart.html' }, ['motion/chart.html']],
      [{ check: 'preview' }, ['motion/other.css']],
    ]);
    expect(strip(runsFor(['music/score/index.html', 'cuttle.json', 'stills/page.png'], project))).toEqual([
      [{ check: 'music', src: 'music/score/index.html' }, ['music/score/index.html']],
      [{ check: 'preview' }, ['cuttle.json', 'stills/page.png']],
    ]);
    expect(runsFor(['out/16x9.mp4', 'preview/sheet.png', '.cuttle/proxy.mp4', 'takes/1/screen.mp4', 'voiceover/a.wav', 'cuttle.json.bak', 'motion/title/index.html~', 'motion/title/.index.html.swp', 'motion/title/.!57659!index.html', '.cuttle/proxy.mp4', '.git/index'], project)).toEqual([]);
    // a cuttle.json that does not read: the preview says what is wrong
    expect(strip(runsFor(['motion/title/index.html'], undefined))).toEqual([[{ check: 'preview' }, ['motion/title/index.html']]]);
  });
});

describe('cuttle watch', () => {
  const reruns = (perFolder: boolean | undefined) => async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-watch-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'motion', 'title'), { recursive: true });
    writeFileSync(join(dir, 'motion', 'title', 'index.html'), '<!doctype html>');
    writeFileSync(join(dir, 'cuttle.json'), JSON.stringify({ version: 1, sources: { screen: 'takes/1/screen.mp4' }, scenes: [{ type: 'motion', id: 's1', src: 'motion/title/index.html', duration: 2 }] }));
    const ran: { run: WatchRun; at: number }[] = [];
    let release: () => void = () => {};
    let slow = false;
    let stdout = '';
    const controller = new AbortController();
    let ready: () => void = () => {};
    const watching = new Promise<void>((done) => (ready = done));
    const stopped = watchCommand(dir, createOutput(true, { stdout: (text) => void (stdout += text), stderr: () => {} }), controller.signal, {
      settleMs: 100,
      perFolder,
      onReady: () => ready(),
      run: async (_dir, run) => {
        ran.push({ run, at: performance.now() });
        if (slow) await new Promise<void>((done) => (release = done));
        return { result: { sheet: 'preview/sheet.png' }, errors: run.check === 'preview' ? ['a warning'] : [] };
      },
    });
    await watching;
    // macOS's FSEvents may report the files written just before the watch began: wait them out
    await new Promise((done) => setTimeout(done, 400));
    const early = ran.length;
    ran.length = 0;
    const until = async (count: number) => {
      const deadline = performance.now() + 5000;
      while (ran.length < count && performance.now() < deadline) await new Promise((done) => setTimeout(done, 20));
      expect(ran.length).toBeGreaterThanOrEqual(count);
    };

    const saved = performance.now();
    writeFileSync(join(dir, 'motion', 'title', 'index.html'), '<!doctype html><p>two');
    const checked = async () => {
      const deadline = performance.now() + 5000;
      while (!ran.some(({ run }) => run.check === 'motion') && performance.now() < deadline) await new Promise((done) => setTimeout(done, 20));
      return ran.find(({ run }) => run.check === 'motion');
    };
    const first = await checked();
    expect(first?.run, JSON.stringify(ran)).toEqual({ check: 'motion', src: 'motion/title/index.html' });
    expect(first!.at - saved).toBeLessThan(2000);

    // saved by rename, as some editors on Windows do
    const before = ran.length;
    writeFileSync(join(dir, 'motion', 'title', 'index.html.new'), '<!doctype html><p>three');
    renameSync(join(dir, 'motion', 'title', 'index.html.new'), join(dir, 'motion', 'title', 'index.html'));
    await until(before + 1);
    expect(ran.slice(before).some(({ run }) => run.check === 'motion')).toBe(true);

    // changes while a check runs: one run after it, for all of them
    await new Promise((done) => setTimeout(done, 300));
    slow = true;
    const during = ran.length;
    writeFileSync(join(dir, 'cuttle.json'), readFileSync(join(dir, 'cuttle.json'), 'utf8').replace('"duration":2', '"duration":3'));
    await until(during + 1);
    writeFileSync(join(dir, 'motion', 'title', 'index.html'), '<!doctype html><p>four');
    writeFileSync(join(dir, 'motion', 'title', 'index.html'), '<!doctype html><p>five');
    await new Promise((done) => setTimeout(done, 400));
    expect(ran.length).toBe(during + 1);
    slow = false;
    release();
    await until(during + 2);
    await new Promise((done) => setTimeout(done, 300));
    expect(ran.slice(during + 1).map(({ run }) => run.check)).toEqual(['motion']);

    // a folder made while it watches: its files too
    const made = ran.length;
    mkdirSync(join(dir, 'motion', 'chart'));
    await new Promise((done) => setTimeout(done, 300));
    writeFileSync(join(dir, 'motion', 'chart', 'index.html'), '<!doctype html>');
    await until(made + 1);

    controller.abort();
    const { updates } = await stopped;
    expect(updates).toBe(early + ran.length);
    // a line of JSON each, the errors first
    const lines = stdout.trim().split('\n').map((line) => JSON.parse(line) as WatchUpdate);
    expect(lines).toHaveLength(updates);
    expect(lines.slice(early).find((line) => line.check === 'motion')).toMatchObject({ check: 'motion', src: 'motion/title/index.html', changed: ['motion/title/index.html'], errors: [], result: { sheet: 'preview/sheet.png' } });
    expect(lines.slice(early).find((line) => line.check === 'preview')).toMatchObject({ changed: ['cuttle.json'], errors: ['a warning'] });
  };
  it('reruns a motion page’s check within two seconds of a save (also one by rename), one run after another', reruns(undefined), 30_000);
  it('does the same with a watch for each folder, as on Linux, where a file saved by rename would get lost', reruns(true), 30_000);

  it('refuses a folder without a project', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-watch-empty-'));
    dirs.push(dir);
    await expect(watchCommand(dir, createOutput(true, { stdout: () => {}, stderr: () => {} }), new AbortController().signal)).rejects.toMatchObject({ code: 'usage' });
  });
});
