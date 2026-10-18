import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

describe('cuttle motion new and templates', () => {
  it('lists the templates', async () => {
    const { code, json } = await cli('--json', 'motion', 'templates');
    expect(code).toBe(0);
    expect(json.templates).toEqual(MOTION_TEMPLATES);
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
