import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { CoreError } from '../src/errors';
import { imagePalette, paletteOf, takePalette } from '../src/palette';
import { importWallpaper } from '../src/wallpaper';
import { parseRegWallpaper } from '../src/wallpaper-win32';

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-palette-'));
  dirs.push(dir);
  return dir;
};
const failure = (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error);
const ffmpeg = (args: string[]) => expect(spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { windowsHide: true }).status).toBe(0);

/** RGBA pixels: `count` of each colour. */
function pixels(...parts: [rgba: [number, number, number, number], count: number][]): Uint8Array {
  return new Uint8Array(parts.flatMap(([rgba, count]) => Array.from({ length: count }, () => rgba).flat()));
}
const channels = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

describe('paletteOf', () => {
  it('takes the clear colours of a grey interface, dark to light, each far from the others', () => {
    const ui = pixels(
      [[245, 245, 245, 255], 5000],
      [[30, 30, 34, 255], 3000],
      [[128, 128, 128, 255], 800],
      [[217, 119, 87, 255], 300], // an orange button
      [[60, 110, 230, 255], 150], // a blue link
      [[219, 121, 89, 255], 50], // nearly the button's orange
    );
    const palette = paletteOf(ui);
    expect(palette.length).toBeGreaterThanOrEqual(2);
    expect(palette.length).toBeLessThanOrEqual(4);
    expect(palette).toContain('#D97757');
    expect(palette.some((color) => channels(color)[2]! > 200 && channels(color)[0]! < 90)).toBe(true);
    // no two alike, and dark to light
    const lum = palette.map((color) => {
      const [r, g, b] = channels(color);
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    });
    expect([...lum].sort((a, b) => a - b)).toEqual(lum);
    expect(palette.filter((color) => channels(color)[0]! > 200 && channels(color)[1]! < 140)).toHaveLength(1);
  });

  it('gives two colours of a picture of one, and leaves transparent pixels out', () => {
    expect(paletteOf(pixels([[200, 40, 40, 255], 100], [[0, 255, 0, 0], 900]))).toEqual(['#5A1212', '#C82828']);
    expect(() => paletteOf(pixels([[0, 0, 0, 0], 10]))).toThrow(CoreError);
  });

  it('takes the tones of a picture of greys', () => {
    expect(paletteOf(pixels([[20, 20, 20, 255], 500], [[200, 200, 200, 255], 300]))).toEqual(['#141414', '#C8C8C8']);
  });
});

describe('the colours of a logo and of a take', () => {
  it('reads an SVG\'s colours, and an image\'s pixels', async () => {
    const dir = temp();
    writeFileSync(join(dir, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#7C5CFF"/><path fill="#fff"/><circle stroke="#ff7ab6"/></svg>');
    expect(await imagePalette(join(dir, 'logo.svg'))).toEqual(['#7C5CFF', '#FF7AB6', '#FFFFFF']);
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x2A9D8F:s=64x32,drawbox=x=0:y=0:w=20:h=32:color=0xE76F51:t=fill', '-frames:v', '1', join(dir, 'logo.png')]);
    const image = await imagePalette(join(dir, 'logo.png'));
    expect(image).toHaveLength(2);
    expect(channels(image[0]!)[1]).toBeGreaterThan(130); // the teal (darker)
    expect(channels(image[1]!)[0]).toBeGreaterThan(200); // the coral
    expect(await failure(imagePalette(join(dir, 'none.svg')))).toMatchObject({ code: 'missing-file' });
  });

  it('reads the colours a take shows, over its whole length', async () => {
    const dir = temp();
    // a grey screen, blue for its first half and orange for its second
    ffmpeg(['-f', 'lavfi', '-i', "color=c=0x202020:s=320x180:d=4,drawbox=x=0:y=0:w=80:h=180:color=0x3C6EE6@1:t=fill:enable='lt(t,2)',drawbox=x=0:y=0:w=80:h=180:color=0xD97757@1:t=fill:enable='gte(t,2)'", '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(dir, 'screen.mp4')]);
    const palette = await takePalette(join(dir, 'screen.mp4'));
    const blueish = palette.some((color) => channels(color)[2]! > 180 && channels(color)[0]! < 110);
    const orangeish = palette.some((color) => channels(color)[0]! > 180 && channels(color)[2]! < 130);
    expect([blueish, orangeish]).toEqual([true, true]);
  });
});

describe('the wallpaper', () => {
  const before = process.env.CUTTLE_WALLPAPER;
  afterEach(() => {
    if (before === undefined) delete process.env.CUTTLE_WALLPAPER;
    else process.env.CUTTLE_WALLPAPER = before;
  });

  it('reads the path out of the registry\'s answer', () => {
    const answer = '\r\nHKEY_CURRENT_USER\\Control Panel\\Desktop\r\n    WallPaper    REG_SZ    C:\\Users\\me\\Pictures\\Lake Tahoe.jpg\r\n\r\n';
    expect(parseRegWallpaper(answer)).toBe('C:\\Users\\me\\Pictures\\Lake Tahoe.jpg');
    expect(parseRegWallpaper('    WallPaper    REG_SZ    \r\n')).toBeUndefined();
    expect(parseRegWallpaper('ERROR: The system was unable to find the specified registry key or value.')).toBeUndefined();
  });

  it('copies it into images/, a file without an extension by its bytes; again the same copy, another a new one', async () => {
    const dir = temp();
    const source = join(temp(), 'TranscodedWallpaper');
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x264653:s=64x36', '-frames:v', '1', '-f', 'image2', '-c:v', 'mjpeg', source]);
    process.env.CUTTLE_WALLPAPER = source;
    expect(await importWallpaper(dir)).toBe('images/wallpaper.jpg');
    expect(await importWallpaper(dir)).toBe('images/wallpaper.jpg');
    expect(readFileSync(join(dir, 'images', 'wallpaper.jpg')).equals(readFileSync(source))).toBe(true);
    const other = join(temp(), 'other.png');
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=0xE9C46A:s=64x36', '-frames:v', '1', other]);
    process.env.CUTTLE_WALLPAPER = other;
    expect(await importWallpaper(dir)).toBe('images/wallpaper.png');
    process.env.CUTTLE_WALLPAPER = source;
    writeFileSync(source, Buffer.concat([readFileSync(source), Buffer.from('changed')]));
    expect(await importWallpaper(dir)).toBe('images/wallpaper-2.jpg');
    expect(readdirSync(join(dir, 'images')).sort()).toEqual(['wallpaper-2.jpg', 'wallpaper.jpg', 'wallpaper.png']);
  });

  it('says when there is none, or it is no image Cuttle reads', async () => {
    const dir = temp();
    process.env.CUTTLE_WALLPAPER = join(dir, 'gone.jpg');
    expect(await failure(importWallpaper(dir))).toMatchObject({ code: 'missing-file' });
    writeFileSync(join(dir, 'photo.heic'), 'not a jpeg');
    process.env.CUTTLE_WALLPAPER = join(dir, 'photo.heic');
    expect(await failure(importWallpaper(dir))).toMatchObject({ code: 'invalid-media' });
  });
});
