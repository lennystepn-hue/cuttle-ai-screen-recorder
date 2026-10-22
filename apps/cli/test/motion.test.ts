import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MOTION_TEMPLATES } from '@cuttle/motion-kit';
import { runCli } from '../src/main';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-motion-'));
  dirs.push(dir);
  return dir;
};

async function cli(...argv: string[]) {
  let stdout = '';
  const code = await runCli(argv, { stdout: (text) => void (stdout += text), stderr: () => {} });
  return { code, json: JSON.parse(stdout) as Record<string, unknown> };
}

const project = (dir: string) => JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { scenes?: Record<string, unknown>[]; overlays?: Record<string, unknown>[] };

/** A page written in the project, as Claude writes one. */
const page = (dir: string, path: string) => {
  mkdirSync(join(dir, path, '..'), { recursive: true });
  writeFileSync(join(dir, path), '<!doctype html><h1>Ship it.</h1>');
};

describe('cuttle motion new and templates', () => {
  it('lists the templates, and says a page of your own goes in with motion add', async () => {
    const { code, json } = await cli('--json', 'motion', 'templates');
    expect(code).toBe(0);
    expect(json.templates).toEqual(MOTION_TEMPLATES);
    expect(json.ownPage).toContain('cuttle motion add');
  });

  it('copies a scene template into motion/, as the first or the last scene, beside a copy already there', async () => {
    const dir = join(temp(), 'reel');
    expect((await cli('--json', 'init', dir)).code).toBe(0);
    const title = await cli('--json', '-C', dir, 'motion', 'new', 'title', '--first');
    expect(title.code).toBe(0);
    expect(title.json).toEqual({
      template: 'title',
      kind: 'scene',
      src: 'motion/title/index.html',
      item: { type: 'motion', id: 's1', label: 'Title', src: 'motion/title/index.html', duration: 3.5 },
    });
    expect(readFileSync(join(dir, 'motion', 'title', 'index.html'), 'utf8')).toMatch(/^<!doctype html>/);
    await cli('--json', '-C', dir, 'motion', 'new', 'end-card', '--duration', '5');
    const again = await cli('--json', '-C', dir, 'motion', 'new', 'title', '--first');
    expect(again.json.src).toBe('motion/title-2/index.html');
    expect(project(dir).scenes!.map((scene) => [scene.id, scene.src, scene.duration])).toEqual([
      ['s3', 'motion/title-2/index.html', 3.5],
      ['s1', 'motion/title/index.html', 3.5],
      ['s2', 'motion/end-card/index.html', 5],
    ]);
  });

  it('puts an overlay over the clips: from the first clip, or over the whole take, or at --at', async () => {
    const dir = temp();
    writeFileSync(
      join(dir, 'cuttle.json'),
      JSON.stringify({ version: 1, sources: { screen: 'takes/1/screen.mp4' }, scenes: [{ type: 'clip', from: 2, to: 10 }, { type: 'clip', from: 12, to: 30, speed: 4 }] }),
    );
    expect((await cli('--json', '-C', dir, 'motion', 'new', 'click-callouts')).json.item).toEqual({ id: 'o1', label: 'Click callouts', src: 'motion/click-callouts/index.html', at: 2, duration: 28 });
    expect((await cli('--json', '-C', dir, 'motion', 'new', 'lower-third', '--at', '3.5', '--name', 'guest')).json.item).toEqual({
      id: 'o2',
      label: 'Guest',
      src: 'motion/guest/index.html',
      at: 3.5,
      duration: 4,
    });
    expect(project(dir).overlays).toHaveLength(2);
    expect(existsSync(join(dir, 'motion', 'guest', 'index.html'))).toBe(true);
  });

  it('refuses an unknown template, a bad name, and an overlay in a video without clips', async () => {
    const dir = join(temp(), 'empty');
    await cli('--json', 'init', dir);
    expect((await cli('--json', '-C', dir, 'motion', 'new', 'sparkles')).json).toMatchObject({ error: { code: 'usage', message: expect.stringContaining('no template "sparkles"') } });
    expect((await cli('--json', '-C', dir, 'motion', 'new', 'title', '--name', 'My Intro')).json).toMatchObject({ error: { code: 'usage' } });
    expect((await cli('--json', '-C', dir, 'motion', 'new', 'lower-third')).json).toMatchObject({ error: { code: 'invalid-project', message: expect.stringContaining('has no clips') } });
  });
});

describe('cuttle motion add', () => {
  it('adds a page of your own as a scene: at the end, first or after a scene, named after its folder', async () => {
    const dir = join(temp(), 'reel');
    await cli('--json', 'init', dir);
    page(dir, 'motion/intro/index.html');
    page(dir, 'motion/chart.html');
    page(dir, 'motion/outro/index.html');
    const intro = await cli('--json', '-C', dir, 'motion', 'add', 'motion/intro/index.html');
    expect(intro.code).toBe(0);
    expect(intro.json).toEqual({ kind: 'scene', src: 'motion/intro/index.html', item: { type: 'motion', id: 's1', label: 'Intro', src: 'motion/intro/index.html', duration: 3 } });
    await cli('--json', '-C', dir, 'motion', 'add', 'motion/outro/index.html', '--duration', '4.5', '--label', 'The end');
    await cli('--json', '-C', dir, 'motion', 'add', 'motion/chart.html', '--after', 's1');
    await cli('--json', '-C', dir, 'motion', 'new', 'title', '--after', '0');
    expect(project(dir).scenes!.map((scene) => [scene.id, scene.label, scene.src, scene.duration])).toEqual([
      ['s1', 'Intro', 'motion/intro/index.html', 3],
      ['s4', 'Title', 'motion/title/index.html', 3.5],
      ['s3', 'Chart', 'motion/chart.html', 3],
      ['s2', 'The end', 'motion/outro/index.html', 4.5],
    ]);
  });

  it('adds one as an overlay over the rest of the clips or for a while, and as the transition into a scene', async () => {
    const dir = temp();
    writeFileSync(
      join(dir, 'cuttle.json'),
      JSON.stringify({ version: 1, sources: { screen: 'takes/1/screen.mp4' }, scenes: [{ type: 'clip', id: 's1', from: 2, to: 10 }, { type: 'clip', id: 's2', from: 12, to: 30 }] }),
    );
    page(dir, 'motion/rings/index.html');
    page(dir, 'motion/wipe/index.html');
    expect((await cli('--json', '-C', dir, 'motion', 'add', 'motion/rings/index.html', '--as', 'overlay', '--at', '5')).json.item).toEqual({ id: 'o1', label: 'Rings', src: 'motion/rings/index.html', at: 5, duration: 25 });
    expect((await cli('--json', '-C', dir, 'motion', 'add', 'motion/rings/index.html', '--as', 'overlay', '--duration', '2')).json.item).toMatchObject({ id: 'o2', at: 2, duration: 2 });
    const wipe = await cli('--json', '-C', dir, 'motion', 'add', 'motion/wipe/index.html', '--as', 'transition', '--into', 's2');
    expect(wipe.json).toEqual({ kind: 'transition', src: 'motion/wipe/index.html', item: { src: 'motion/wipe/index.html', duration: 0.8 }, into: 1 });
    expect(project(dir).scenes![1]!.transition).toEqual({ src: 'motion/wipe/index.html', duration: 0.8 });
  });

  it('refuses a page outside the project, one that is not there or not a page, an unknown kind, and an overlay without clips', async () => {
    const dir = join(temp(), 'empty');
    await cli('--json', 'init', dir);
    page(dir, 'motion/a/index.html');
    writeFileSync(join(dir, 'notes.txt'), 'no page');
    writeFileSync(join(dir, '..', 'outside.html'), '<!doctype html>');
    const error = async (...argv: string[]) => (await cli('--json', '-C', dir, 'motion', 'add', ...argv)).json.error as { code: string; message: string };
    expect(await error(join(dir, '..', 'outside.html'))).toMatchObject({ code: 'usage', message: expect.stringContaining('not in the project folder') });
    expect(await error('motion/b/index.html')).toMatchObject({ code: 'missing-file' });
    expect(await error('notes.txt')).toMatchObject({ code: 'usage', message: expect.stringContaining('not a page') });
    expect(await error('motion/a/index.html', '--as', 'sticker')).toMatchObject({ code: 'usage' });
    expect(await error('motion/a/index.html', '--first', '--after', '0')).toMatchObject({ code: 'usage' });
    expect(await error('motion/a/index.html', '--after', 's9')).toMatchObject({ code: 'usage' });
    expect(await error('motion/a/index.html', '--as', 'overlay')).toMatchObject({ code: 'invalid-project', message: expect.stringContaining('has no clips') });
    expect(project(dir).scenes ?? []).toEqual([]);
  });
});
