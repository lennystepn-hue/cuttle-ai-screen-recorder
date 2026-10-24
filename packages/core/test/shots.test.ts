import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { findShotStyle, imageSize, listShotStyles, lookFrom, lookInto, saveShotStyle, secretMasks, shotBrand, shotLook, shotStyleFor } from '../src/shots';

const dir = mkdtempSync(join(tmpdir(), 'cuttle-shot-styles-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

const line = (words: [string, number][]) => ({ words: words.map(([t, x]) => ({ t, text: t, rect: [x, 100, t.length * 8, 16] as [number, number, number, number] })) });

describe("a screenshot's privacy", () => {
  it('masks the private words the text shows, filled, a little larger, inside the image', () => {
    const masks = secretMasks([line([['mail', 10], ['ada@example.com', 60]]), line([['nothing', 10], ['here', 80]])] as never, { width: 200, height: 120 });
    expect(masks).toHaveLength(1);
    expect(masks[0]).toMatchObject({ style: 'fill', auto: 'privacy' });
    const [x, y, w, h] = masks[0]!.rect;
    expect(x).toBeLessThan(60);
    expect(y).toBeLessThan(100);
    // inside the image: the right edge stops at its width
    expect(x + w).toBeLessThanOrEqual(200);
    expect(y + h).toBeLessThanOrEqual(120);
  });

  it('masks the words the person always wants hidden', () => {
    expect(secretMasks([line([['Ada', 10], ['Lovelace', 50]])] as never, { width: 400, height: 200 }, ['Lovelace'])).toHaveLength(1);
  });
});

describe('screenshot styles', () => {
  const file = join(dir, 'styles.json');

  it("keeps a shot's look by name: not its picture, its masks or its headline's words", async () => {
    expect(await listShotStyles(file)).toEqual({});
    const raw = { version: 1, source: 'source.png', scale: 2, crop: [0, 0, 10, 10], masks: [{ rect: [0, 0, 5, 5] }], headline: { title: 'Hi' }, padding: 20, background: { preset: 'aurora' }, frame: { style: 'mac-dark' } };
    await saveShotStyle('Launch', raw, file);
    expect(await findShotStyle('Launch', file)).toEqual({ padding: 20, background: { preset: 'aurora' }, frame: { style: 'mac-dark' } });
    expect(shotLook(raw)).toEqual({ padding: 20, background: { preset: 'aurora' }, frame: { style: 'mac-dark' } });
    await expect(findShotStyle('Docs', file)).rejects.toThrow(/no screenshot style "Docs" \(Launch\)/);
    await saveShotStyle('Launch', undefined, file);
    expect(await listShotStyles(file)).toEqual({});
  });

  it('keeps the images a style names, and copies them into the shot it is used for', async () => {
    const from = join(dir, 'from');
    const to = join(dir, 'to');
    mkdirSync(join(from, 'images'), { recursive: true });
    writeFileSync(join(from, 'images', 'wall.png'), 'png');
    await saveShotStyle('Wall', { background: { preset: 'image', image: 'images/wall.png' }, watermark: { image: '/gone/logo.png' } }, file, from);
    expect((await findShotStyle('Wall', file)).background).toEqual({ preset: 'image', image: join(from, 'images', 'wall.png') });
    mkdirSync(to);
    const look = await shotStyleFor('Wall', to, file);
    expect(look.background).toEqual({ preset: 'image', image: 'images/wall.png' });
    expect(readFileSync(join(to, 'images', 'wall.png'), 'utf8')).toBe('png');
    // the logo is gone: no watermark
    expect(look.watermark).toBeUndefined();
  });

  it("takes the last shot's look to the next one: its images along, into the new shot's folder", async () => {
    const last = join(dir, 'last');
    const next = join(dir, 'next');
    mkdirSync(join(last, 'brand'), { recursive: true });
    mkdirSync(next);
    writeFileSync(join(last, 'brand', 'acme-logo.svg'), '<svg/>');
    const kept = lookFrom({ version: 1, source: 'source.png', padding: 8, watermark: { image: 'brand/acme-logo.svg', corner: 'top-left' } }, last);
    expect(kept).toEqual({ padding: 8, watermark: { image: join(last, 'brand', 'acme-logo.svg'), corner: 'top-left' } });
    const look = await lookInto(kept, next);
    const image = (look.watermark as { image: string }).image;
    expect(isAbsolute(image)).toBe(false);
    expect(readFileSync(join(next, image), 'utf8')).toBe('<svg/>');
  });
});

describe('a brand kit on a screenshot', () => {
  const root = join(dir, 'brands');
  const kit = (slug: string, theme: Record<string, unknown>) => {
    mkdirSync(join(root, slug), { recursive: true });
    const look = { background: { preset: 'solid', color: '#102030' }, frame: { style: 'browser-dark' }, cursor: { style: 'system', color: '#ffffff' } };
    writeFileSync(join(root, slug, 'brand.json'), JSON.stringify({ version: 1, name: theme.name ?? slug, theme, look }));
  };

  it('puts on its background, frame and font, and its logo in a corner (or its name, without one)', async () => {
    kit('orbit', { name: 'Orbit', logo: 'logo.svg', font: 'Fraunces' });
    writeFileSync(join(root, 'orbit', 'logo.svg'), '<svg/>');
    kit('nova', { name: 'Nova' });
    const shot = join(dir, 'branded');
    mkdirSync(shot);
    const orbit = await shotBrand('Orbit', shot, root);
    expect(orbit).toMatchObject({ background: { preset: 'solid', color: '#102030' }, frame: { style: 'browser-dark' }, font: 'Fraunces' });
    expect(readFileSync(join(shot, (orbit.watermark as { image: string }).image), 'utf8')).toBe('<svg/>');
    // a kit names no font: the videos' titles' own
    expect(await shotBrand('Nova', shot, root)).toMatchObject({ watermark: { text: 'Nova' }, font: 'Archivo' });
  });
});

describe("an image's size", () => {
  it('reads it from a PNG, a JPEG and a WebP (lossy and lossless)', () => {
    for (const [name, args] of [
      ['a.png', []],
      ['a.jpg', []],
      ['a.webp', ['-lossless', '0']],
      ['b.webp', ['-lossless', '1']],
    ] as const) {
      const file = join(dir, name);
      expect(spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x122', '-frames:v', '1', ...args, file], { windowsHide: true }).status, name).toBe(0);
      expect(imageSize(readFileSync(file)), name).toEqual({ width: 320, height: 122 });
    }
    expect(imageSize(Buffer.from('not an image'))).toBeUndefined();
  });
});
