import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileHost } from '../../src/main/files';

let dir: string;
let media: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cuttle-files-'));
  media = join(dir, 'screen.mp4');
  await writeFile(media, Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  await writeFile(join(dir, 'cuttle.json'), '{}');
});

afterAll(() => rm(dir, { recursive: true, force: true }));

describe('FileHost', () => {
  it('reads sizes and byte ranges of the job files', async () => {
    const host = new FileHost([media], join(dir, 'out.mp4'));
    expect(await host.size(media)).toBe(10);
    expect([...(await host.read(media, 2, 5))]).toEqual([2, 3, 4]);
    expect([...(await host.read(media, 8, 20))]).toEqual([8, 9]);
    await host.close();
  });

  it('refuses every other file', async () => {
    const host = new FileHost([media], join(dir, 'out.mp4'));
    await expect(host.read(join(dir, 'cuttle.json'), 0, 1)).rejects.toThrow('outside the job');
    await expect(host.readFile(join(dir, 'cuttle.json'))).rejects.toThrow('not an image of the job');
    await host.close();
  });

  it('reads whole files only for images, and only sane byte ranges', async () => {
    const image = join(dir, 'page.png');
    await writeFile(image, Uint8Array.from([1, 2, 3]));
    const host = new FileHost([media], join(dir, 'out.mp4'), [image]);
    expect([...(await host.readFile(image))]).toEqual([1, 2, 3]);
    await expect(host.readFile(media)).rejects.toThrow('not an image of the job');
    await expect(host.read(media, 5, 2)).rejects.toThrow('invalid byte range');
    await expect(host.read(media, -1, 2)).rejects.toThrow('invalid byte range');
    await expect(host.read(media, 0, 2 ** 31)).rejects.toThrow('invalid byte range');
    await expect(host.write(Uint8Array.from([1]), -5)).rejects.toThrow('invalid write position');
    await host.close();
  });

  it('refuses everything after close, so a late write cannot truncate the finished output', async () => {
    const out = join(dir, 'closed.mp4');
    const host = new FileHost([media], out);
    await host.write(Uint8Array.from([1, 2, 3]), 0);
    await host.close();
    await expect(host.write(Uint8Array.from([9]), 0)).rejects.toThrow('closed');
    await expect(host.read(media, 0, 1)).rejects.toThrow('closed');
    expect([...(await readFile(out))]).toEqual([1, 2, 3]);
  });

  it('writes the output at byte positions', async () => {
    const out = join(dir, 'out.mp4');
    const host = new FileHost([], out);
    await host.write(Uint8Array.from([5, 6, 7]), 2);
    await host.write(Uint8Array.from([1, 2]), 0);
    await host.close();
    expect([...(await readFile(out))]).toEqual([1, 2, 5, 6, 7]);
  });
});
