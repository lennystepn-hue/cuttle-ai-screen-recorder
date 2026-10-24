import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { pngScale } from '@cuttle/core';
import { runCli } from '../src/main';
import { pngWith } from './png-fixture';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-shot-'));
  dirs.push(dir);
  return dir;
};

async function cli(...argv: string[]) {
  let stdout = '';
  const code = await runCli(argv, { stdout: (text) => void (stdout += text), stderr: () => {} });
  return { code, json: JSON.parse(stdout) as Record<string, unknown> };
}

describe("a screenshot's scale", () => {
  it("reads a PNG's resolution: a Mac's 144 dpi is 2 pixels a point, 72 and 96 dpi are 1", () => {
    expect(pngScale(pngWith(4, 4, 144))).toBe(2);
    expect(pngScale(pngWith(4, 4, 216))).toBe(3);
    expect(pngScale(pngWith(4, 4, 72))).toBe(1);
    expect(pngScale(pngWith(4, 4, 96))).toBe(1);
    expect(pngScale(pngWith(4, 4))).toBeUndefined();
    expect(pngScale(Buffer.from('not a png'))).toBeUndefined();
  });
});

describe('cuttle shot frame', () => {
  it('refuses what it cannot write before drawing anything, and leaves the shot as it was', async () => {
    const dir = temp();
    const folder = join(dir, 'kept');
    mkdirSync(folder);
    writeFileSync(join(folder, 'source.png'), pngWith(8, 8));
    const shot = { version: 1, source: 'source.png', transparent: true };
    writeFileSync(join(folder, 'shot.json'), JSON.stringify(shot));
    const jpeg = await cli('--json', 'shot', 'frame', folder, '-o', join(dir, 'out.jpg'));
    expect(jpeg.code).toBe(1);
    expect((jpeg.json.error as { message: string }).message).toMatch(/JPEG has no transparency/);
    const changed = await cli('--json', 'shot', 'frame', folder, '--padding', '10', '-o', join(dir, 'out.gif'));
    expect((changed.json.error as { message: string }).message).toMatch(/\.png, \.jpg or \.webp/);
    expect(JSON.parse(readFileSync(join(folder, 'shot.json'), 'utf8'))).toEqual(shot);
  });

  it('names what is wrong: a frame, a size, a crop, a file that is not an image', async () => {
    const dir = temp();
    const image = join(dir, 'shot.png');
    writeFileSync(image, pngWith(8, 8));
    const message = async (...argv: string[]) => ((await cli('--json', 'shot', 'frame', image, ...argv)).json.error as { message: string }).message;
    expect(await message('--frame', 'tv')).toMatch(/no frame "tv"/);
    expect(await message('--size', 'big')).toMatch(/--size big/);
    expect(await message('--crop', '1,2,3')).toMatch(/--crop 1,2,3/);
    expect(await message('-o', image)).toMatch(/the shot's own image/);
    writeFileSync(join(dir, 'notes.txt'), 'hello');
    expect(((await cli('--json', 'shot', 'frame', join(dir, 'notes.txt'))).json.error as { message: string }).message).toMatch(/not a PNG, JPEG or WebP/);
  });
});

describe('cuttle shot take', () => {
  it('takes a region at its exact size into a new shot folder, named by the time, raw when asked', async () => {
    const library = temp();
    const before = process.env.CUTTLE_SHOTS_DIR;
    process.env.CUTTLE_SHOTS_DIR = library;
    try {
      const taken = await cli('--json', 'shot', 'take', '--backend', 'test', '--region', '10,20,301,201', '--raw');
      expect(taken.code).toBe(0);
      const folder = taken.json.shot as string;
      expect(folder.startsWith(library)).toBe(true);
      expect(basename(folder)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}$/);
      expect(taken.json).toMatchObject({ file: join(folder, 'source.png'), source: join(folder, 'source.png'), width: 301, height: 201, scale: 1 });
      expect(JSON.parse(readFileSync(join(folder, 'shot.json'), 'utf8'))).toEqual({ version: 1, source: 'source.png' });
      // a second one in the same second gets a folder of its own
      const again = await cli('--json', 'shot', '--backend', 'test', '--window', 'Test Window', '--raw');
      expect(again.json).toMatchObject({ width: 640, height: 360, window: 'Test Window' });
      expect(again.json.shot).not.toBe(folder);
    } finally {
      if (before === undefined) delete process.env.CUTTLE_SHOTS_DIR;
      else process.env.CUTTLE_SHOTS_DIR = before;
    }
  });

  it('refuses a folder that holds a shot, and a source it cannot take', async () => {
    const folder = temp();
    writeFileSync(join(folder, 'shot.json'), '{}');
    expect(((await cli('--json', 'shot', 'take', '--backend', 'test', '--save', folder)).json.error as { message: string }).message).toMatch(/holds a shot already/);
    expect(((await cli('--json', 'shot', 'take', '--backend', 'test', '--monitor', '5', '--save', join(temp(), 'new'))).json.error as { code: string }).code).toBe('device-not-found');
  });
});
