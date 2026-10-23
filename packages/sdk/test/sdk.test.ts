import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { card, cuttleCommand, motion, newsOf, runCuttle, video } from '../src/index';

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-sdk-'));
  dirs.push(dir);
  return dir;
};
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

/** A stand-in for the cuttle command: it answers with the arguments it got, or an error for `fail`. */
function fakeCli(): string {
  const path = join(temp(), 'cuttle.mjs');
  writeFileSync(
    path,
    "const args = process.argv.slice(2); if (args.includes('fail')) { process.stdout.write(JSON.stringify({ error: { code: 'usage', message: 'it failed' } })); process.exit(1); } process.stdout.write(JSON.stringify({ args }));",
  );
  return path;
}

describe('@cuttle/sdk', () => {
  it('builds a video in code: its scenes, a template copied in, a caption and music, saved as a valid cuttle.json', async () => {
    const dir = join(temp(), 'release');
    const v = video({ dir, output: '9:16', fps: 60, theme: { name: 'Nimbus', accent: '#7C5CFF' } });
    const title = await v.template('title');
    const score = await v.template('lofi', { music: true });
    expect([title, score]).toEqual(['motion/title/index.html', 'music/lofi/index.html']);
    expect(existsSync(join(dir, title))).toBe(true);
    v.scene(motion(title, { duration: 3, params: { title: 'Version 2' } }))
      .scene(card('Built with Cuttle', { subtitle: 'cuttle.dev', enter: 'pop' }))
      .music(score, { volume: 0.6 });
    const project = v.toProject();
    expect(project.output).toMatchObject({ width: 1080, height: 1920, fps: 60 });
    expect(project.scenes.map((scene) => scene.type)).toEqual(['motion', 'card']);
    const path = await v.save();
    const saved = JSON.parse(readFileSync(path, 'utf8')) as { scenes: unknown[]; music: unknown; theme: unknown };
    expect(saved.scenes).toEqual([
      { type: 'motion', src: 'motion/title/index.html', duration: 3, params: { title: 'Version 2' } },
      { type: 'card', title: 'Built with Cuttle', subtitle: 'cuttle.dev', duration: 2, enter: 'pop' },
    ]);
    expect(saved.music).toEqual({ volume: 0.6, src: 'music/lofi/index.html' });
    // what is not a project is refused, saying what
    expect(() => video({ dir }).scene(card('x', { duration: -1 })).toProject()).toThrow(/scenes\[0\]\.duration/);
  });

  it('runs the cuttle command on it: the render’s options as the CLI has them, its JSON back, its error as an Error', async () => {
    const cli = fakeCli();
    const dir = join(temp(), 'video');
    const v = video({ dir, cli }).scene(card('Hello'));
    const result = await v.render({ formats: ['16:9', '9:16'], loudness: 'youtube', size: '4k', fps: 60, codec: 'hevc' });
    expect(result.args).toEqual(['--json', '-C', dir, 'render', '--format', '16:9', '--format', '9:16', '--loudness', 'youtube', '--size', '4k', '--fps', '60', '--codec', 'hevc']);
    expect((await v.preview({ at: [1, 2.5], sheet: true })).args).toEqual(['--json', '-C', dir, 'preview', '--at', '1', '--at', '2.5', '--sheet']);
    await expect(runCuttle(['--json', 'fail'], cli)).rejects.toMatchObject({ message: 'it failed', code: 'usage' });
  });

  it('finds the command: a CLI script runs with this Node, a command on Windows through its shell (cuttle.cmd)', () => {
    expect(cuttleCommand('/x/cuttle.mjs', 'darwin')).toEqual({ command: process.execPath, prefix: ['/x/cuttle.mjs'], shell: false });
    expect(cuttleCommand('cuttle', 'win32')).toEqual({ command: 'cuttle', prefix: [], shell: true });
    expect(cuttleCommand('cuttle', 'darwin').shell).toBe(false);
  });
});

describe('newsOf', () => {
  it("takes the top-level bullets under the notes' heading of what is new, their bold words when they start with some", () => {
    const notes = [
      'A new look.',
      '',
      '## Download',
      '',
      '- **Windows:** `Cuttle-0.1.13-win-x64.exe`.',
      '',
      '## New in this version',
      '',
      '- **The editor, redesigned:**',
      '  - The panels are cards.',
      '- **A layout of your own:**',
      '- Exports in [4K](https://example.com/4k) at `60 fps`.',
      '- A line much too long for a card, which goes on and on about everything it changed in the app.',
      '',
      '## Thanks',
      '- Everyone',
    ].join('\n');
    expect(newsOf(notes)).toEqual(['The editor, redesigned', 'A layout of your own', 'Exports in 4K at 60 fps', 'A line much too long for a card, which goes on and on about…']);
    expect(newsOf(notes, 2)).toHaveLength(2);
  });

  it("reads GitHub's generated notes, and bullets anywhere when no heading says what is new", () => {
    const generated = [
      "## What's Changed",
      '* Zoom paths by @someone in https://github.com/o/r/pull/116',
      '* Fix the brand check (#143)',
      '',
      '## New Contributors',
      '* @someone made their first contribution in https://github.com/o/r/pull/116',
      '',
      '**Full Changelog**: https://github.com/o/r/compare/v1...v2',
    ].join('\n');
    expect(newsOf(generated)).toEqual(['Zoom paths', 'Fix the brand check']);
    expect(newsOf('Faster.\n\n- One\n- Two')).toEqual(['One', 'Two']);
    expect(newsOf('Nothing in bullets.')).toEqual([]);
  });
});
