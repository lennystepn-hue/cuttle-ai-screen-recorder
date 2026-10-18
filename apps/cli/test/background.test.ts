import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/main';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-background-'));
  dirs.push(dir);
  return dir;
};
const ffmpeg = (args: string[]) => expect(spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { windowsHide: true }).status).toBe(0);
const projectWith = (fields: Record<string, unknown> = {}) => {
  const dir = temp();
  writeFileSync(join(dir, 'cuttle.json'), JSON.stringify({ version: 1, sources: { screen: 'takes/1/screen.mp4' }, ...fields }));
  return dir;
};
const background = (dir: string) => (JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { look: { background: Record<string, unknown> } }).look.background;

async function cli(...argv: string[]) {
  let stdout = '';
  const code = await runCli(argv, { stdout: (text) => void (stdout += text), stderr: () => {} });
  return { code, json: JSON.parse(stdout) as Record<string, unknown> };
}

describe('cuttle background', () => {
  const before = process.env.CUTTLE_WALLPAPER;
  afterEach(() => {
    if (before === undefined) delete process.env.CUTTLE_WALLPAPER;
    else process.env.CUTTLE_WALLPAPER = before;
  });

  it('sets a preset, keeping only the fields it reads', async () => {
    const dir = projectWith({ look: { background: { preset: 'solid', color: '#102030' }, frame: { title: 'mine' } } });
    expect((await cli('--json', '-C', dir, 'background', 'flow')).json).toEqual({ background: { preset: 'flow' } });
    expect(background(dir)).toEqual({ preset: 'flow' });
    expect((JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { look: { frame: unknown } }).look.frame).toEqual({ title: 'mine' });
    // colours given to a background that takes colours keep it; a solid one by its colour
    await cli('--json', '-C', dir, 'background', '--colors', '#401010,#FF3030');
    expect(background(dir)).toEqual({ preset: 'flow', colors: ['#401010', '#FF3030'] });
    await cli('--json', '-C', dir, 'background', '--color', '#0C0C0C');
    expect(background(dir)).toEqual({ preset: 'solid', color: '#0C0C0C' });
  });

  it('makes a gradient: its colours, its angle, radial and back', async () => {
    const dir = projectWith();
    await cli('--json', '-C', dir, 'background', 'gradient');
    expect(background(dir)).toEqual({ preset: 'gradient', colors: ['#7C5CFF', '#FF7AB6'] });
    await cli('--json', '-C', dir, 'background', '--colors', '#0B132B, #3A506B,#5BC0BE', '--angle', '90', '--radial');
    expect(background(dir)).toEqual({ preset: 'gradient', colors: ['#0B132B', '#3A506B', '#5BC0BE'], angle: 90, kind: 'radial' });
    await cli('--json', '-C', dir, 'background', '--linear');
    expect(background(dir)).toEqual({ preset: 'gradient', colors: ['#0B132B', '#3A506B', '#5BC0BE'], angle: 90 });
  });

  it('takes the colours of the take, of the logo and of an image', async () => {
    const dir = projectWith({ theme: { logo: 'brand/logo.svg' } });
    mkdirSync(join(dir, 'takes', '1'), { recursive: true });
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x202020:s=320x180:d=2,drawbox=x=0:y=0:w=120:h=180:color=0x3C6EE6@1:t=fill', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(dir, 'takes', '1', 'screen.mp4')]);
    const take = await cli('--json', '-C', dir, 'background', '--from', 'take');
    expect(take.code).toBe(0);
    expect(background(dir).preset).toBe('gradient');
    expect((background(dir).colors as string[]).length).toBeGreaterThanOrEqual(2);
    mkdirSync(join(dir, 'brand'));
    writeFileSync(join(dir, 'brand', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#7C5CFF"/><path fill="#FF7AB6"/></svg>');
    await cli('--json', '-C', dir, 'background', 'bokeh', '--from', 'logo');
    expect(background(dir)).toEqual({ preset: 'bokeh', colors: ['#7C5CFF', '#FF7AB6'] });
    const image = join(temp(), 'swatch.png');
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=0xE76F51:s=32x32', '-frames:v', '1', image]);
    await cli('--json', '-C', dir, 'background', '--from', image);
    // the coral (ffmpeg's colour source rounds it a little), and a darker shade of it
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt((background(dir).colors as string[])[1]!.slice(at, at + 2), 16));
    expect([r, g, b].every((value, i) => Math.abs(value! - [0xe7, 0x6f, 0x51][i]!) <= 3)).toBe(true);
  });

  it('puts an image or the wallpaper behind the window, softened and darkened', async () => {
    const dir = projectWith();
    const outside = join(temp(), 'Desk Photo.png');
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x2A9D8F:s=64x36', '-frames:v', '1', outside]);
    await cli('--json', '-C', dir, 'background', '--image', outside, '--blur', '0.3', '--dim', '0.2');
    expect(background(dir)).toEqual({ preset: 'image', image: 'images/Desk-Photo.png', blur: 0.3, dim: 0.2 });
    expect(existsSync(join(dir, 'images', 'Desk-Photo.png'))).toBe(true);
    process.env.CUTTLE_WALLPAPER = outside;
    await cli('--json', '-C', dir, 'background', 'image', '--wallpaper');
    expect(background(dir)).toEqual({ preset: 'image', image: 'images/wallpaper.png', blur: 0.3, dim: 0.2 });
    await cli('--json', '-C', dir, 'background', 'aurora');
    await cli('--json', '-C', dir, 'background', '--wallpaper');
    expect(background(dir)).toEqual({ preset: 'image', image: 'images/wallpaper.png', blur: 0.6 });
  });

  it('refuses what it cannot do', async () => {
    const dir = projectWith();
    expect((await cli('--json', '-C', dir, 'background', 'plaid')).json).toMatchObject({ error: { code: 'usage' } });
    expect((await cli('--json', '-C', dir, 'background', '--radial', '--linear')).json).toMatchObject({ error: { code: 'usage' } });
    expect((await cli('--json', '-C', dir, 'background', '--colors', 'red,blue')).json).toMatchObject({ error: { code: 'invalid-project' } });
    expect((await cli('--json', '-C', dir, 'background', '--from', 'logo')).json).toMatchObject({ error: { code: 'usage' } });
    expect((await cli('--json', '-C', dir, 'background', '--from', 'take')).json).toMatchObject({ error: { code: 'missing-file' } });
    expect((await cli('--json', '-C', dir, 'background', '--angle', '400')).json).toMatchObject({ error: { code: 'usage' } });
    expect((await cli('--json', '-C', dir, 'background', '--image', join(dir, 'none.png'))).json).toMatchObject({ error: { code: 'missing-file' } });
  });
});
