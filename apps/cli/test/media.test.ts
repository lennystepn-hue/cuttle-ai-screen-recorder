import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { searchStock, stockItem, stockName } from '@cuttle/core';
import { runCli } from '../src/main';

/**
 * Pexels, Pixabay and Freesound as a local server answers them (CUTTLE_BLOCKS_PROXY sends every
 * request there as `<server>/<host><path>`), with what each request carried, to check the keys go
 * where each service wants them.
 */
const seen: { path: string; authorization?: string }[] = [];
let footage: Buffer;
const pexelsVideo = {
  id: 857195,
  width: 3840,
  height: 2160,
  duration: 12,
  url: 'https://www.pexels.com/video/city-at-night-857195/',
  image: 'https://images.pexels.com/videos/857195/poster.jpg',
  user: { name: 'Ana Lens' },
  video_files: [
    { width: 3840, height: 2160, link: 'https://videos.pexels.com/video-files/857195/uhd.mp4', file_type: 'video/mp4' },
    { width: 1920, height: 1080, link: 'https://videos.pexels.com/video-files/857195/hd.mp4', file_type: 'video/mp4' },
    { width: 640, height: 360, link: 'https://videos.pexels.com/video-files/857195/sd.mp4', file_type: 'video/mp4' },
  ],
};
const answers: Record<string, () => Buffer | string> = {
  'api.pexels.com/videos/search': () => JSON.stringify({ videos: [pexelsVideo] }),
  'api.pexels.com/videos/videos/857195': () => JSON.stringify(pexelsVideo),
  'api.pexels.com/v1/photos/2178': () => JSON.stringify({ id: 2178, width: 4000, height: 3000, url: 'https://www.pexels.com/photo/desk-2178/', alt: 'A desk by a window', photographer: 'Kim Lee', src: { large2x: 'https://images.pexels.com/photos/2178/desk.jpeg?w=1880', medium: 'https://images.pexels.com/photos/2178/desk.jpeg?w=350' } }),
  'images.pexels.com/photos/2178/desk.jpeg': () => 'JPEG',
  'videos.pexels.com/video-files/857195/hd.mp4': () => footage,
  'pixabay.com/api/videos/': () => JSON.stringify({ hits: [{ id: 31377, pageURL: 'https://pixabay.com/videos/rain-31377/', tags: 'rain, window', duration: 18, user: 'drop', videos: { large: { url: 'https://cdn.pixabay.com/video/large.mp4', width: 1920, height: 1080, thumbnail: 'https://cdn.pixabay.com/video/large.jpg' }, small: { url: 'https://cdn.pixabay.com/video/small.mp4', width: 960, height: 540 } } }] }),
  'freesound.org/apiv2/search/text/': () => JSON.stringify({ results: [{ id: 41579, name: 'paper tear', duration: 1.2, license: 'https://creativecommons.org/licenses/by-nc/4.0/', username: 'foley', url: 'https://freesound.org/s/41579/', previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/41/41579-hq.mp3' } }] }),
  'freesound.org/apiv2/sounds/41579/': () => JSON.stringify({ id: 41579, name: 'paper tear', duration: 1.2, license: 'http://creativecommons.org/publicdomain/zero/1.0/', username: 'foley', url: 'https://freesound.org/s/41579/', previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/41/41579-hq.mp3' } }),
  'cdn.freesound.org/previews/41/41579-hq.mp3': () => 'MP3',
};

let server: Server;
const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-media-'));
  dirs.push(dir);
  return dir;
};
const keys = { PEXELS_API_KEY: 'pexels-key', PIXABAY_API_KEY: 'pixabay-key', FREESOUND_API_KEY: 'freesound-key' };

beforeAll(async () => {
  // two seconds of footage to convert, as a service would send it
  const dir = temp();
  spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=25:duration=2', '-pix_fmt', 'yuv420p', '-y', join(dir, 'f.mp4')]);
  footage = readFileSync(join(dir, 'f.mp4'));
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://local');
    const path = url.pathname.slice(1);
    seen.push({ path: `${path}${url.search}`, ...(request.headers.authorization && { authorization: request.headers.authorization }) });
    const answer = answers[path];
    if (!answer) return void response.writeHead(404).end();
    response.writeHead(200).end(answer());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.CUTTLE_BLOCKS_PROXY = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(process.env, keys);
});
afterAll(async () => {
  delete process.env.CUTTLE_BLOCKS_PROXY;
  for (const key of Object.keys(keys)) delete process.env[key];
  await new Promise((resolve) => server.close(resolve));
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function cli(...argv: string[]) {
  let stdout = '';
  const code = await runCli(argv, { stdout: (text) => void (stdout += text), stderr: () => {} });
  return { code, json: JSON.parse(stdout) as Record<string, unknown> };
}

describe('stock media', () => {
  it('finds footage, photos and sounds with their licences, each key where its service wants it', async () => {
    const [video] = await searchStock(['city', 'night'], { kind: 'video', longSide: 1920 });
    expect(video).toMatchObject({ id: 'pexels:video:857195', title: 'city at night', author: 'Ana Lens', attribution: false, file: 'https://videos.pexels.com/video-files/857195/hd.mp4' });
    expect(seen.find((request) => request.path.startsWith('api.pexels.com/videos/search'))?.authorization).toBe('pexels-key');
    // for a 4K video, the file that covers it
    expect((await stockItem('pexels:video:857195', 3840)).file).toMatch(/uhd\.mp4$/);
    const [rain] = await searchStock(['rain'], { source: 'pixabay' });
    expect(rain).toMatchObject({ id: 'pixabay:video:31377', file: 'https://cdn.pixabay.com/video/large.mp4', preview: 'https://cdn.pixabay.com/video/large.jpg', license: expect.stringContaining('Pixabay') });
    expect(seen.find((request) => request.path.startsWith('pixabay.com/api/videos/'))?.path).toContain('key=pixabay-key');
    const [tear] = await searchStock(['paper', 'tear'], { kind: 'sound' });
    expect(tear).toMatchObject({ id: 'freesound:sound:41579', duration: 1.2, attribution: true, nonCommercial: true, license: 'CC BY-NC' });
    expect(seen.find((request) => request.path.startsWith('freesound.org/apiv2/search'))?.authorization).toBe('Token freesound-key');
  });

  it('says which key is missing and where to get one, and keeps a key out of what it says', async () => {
    delete process.env.FREESOUND_API_KEY;
    await expect(searchStock(['rain'], { kind: 'sound' })).rejects.toMatchObject({ code: 'media-key', message: expect.stringContaining('FREESOUND_API_KEY') });
    process.env.FREESOUND_API_KEY = keys.FREESOUND_API_KEY;
    await expect(stockItem('pixabay:photo:404')).rejects.toSatisfy((error: Error) => !error.message.includes('pixabay-key'));
    expect(() => stockName('freesound:video:1')).toThrow(/not stock media/);
  });

  it('brings footage in converted, as a scene a page plays, a photo as a still that moves and a sound into sounds/, with the credits', async () => {
    const dir = join(temp(), 'p');
    await cli('--json', 'init', dir);
    const video = await cli('--json', '-C', dir, 'media', 'add', 'pexels:video:857195', '--scene');
    expect(video.code).toBe(0);
    expect(video.json).toMatchObject({ file: 'media/pexels-video-857195.mp4', credit: { author: 'Ana Lens' }, added: { kind: 'scene', src: 'motion/pexels-video-857195/index.html' } });
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,color_primaries', '-of', 'csv=p=0', join(dir, 'media', 'pexels-video-857195.mp4')], { encoding: 'utf8' }).stdout.trim();
    expect(probe).toBe('h264,1920,1080,bt709,30/1');
    expect(readFileSync(join(dir, 'motion', 'pexels-video-857195', 'index.html'), 'utf8')).toContain("cuttle.video('/media/pexels-video-857195.mp4')");
    expect(existsSync(join(dir, 'media', '.pexels-video-857195.download'))).toBe(false);
    const photo = await cli('--json', '-C', dir, 'media', 'add', 'pexels:photo:2178', '--scene', '--first');
    expect(photo.json).toMatchObject({ file: 'media/pexels-photo-2178.jpeg', added: { scene: { type: 'still', image: 'media/pexels-photo-2178.jpeg', motion: 'kenburns', duration: 4 } } });
    const scenes = (JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { scenes: { type: string }[] }).scenes;
    expect(scenes.map((scene) => scene.type)).toEqual(['still', 'motion']);
    const sound = await cli('--json', '-C', dir, 'media', 'add', 'freesound:sound:41579');
    expect(sound.json).toMatchObject({ file: 'sounds/freesound-sound-41579.mp3', credit: { license: 'CC0 (no rights reserved)' } });
    expect(readFileSync(join(dir, 'CREDITS.md'), 'utf8')).toContain('Pexels, a video by Ana Lens');
    expect((await cli('--json', '-C', dir, 'media', 'add', 'freesound:sound:41579', '--scene')).json).toMatchObject({ error: { code: 'usage' } });
  }, 60_000);
});
