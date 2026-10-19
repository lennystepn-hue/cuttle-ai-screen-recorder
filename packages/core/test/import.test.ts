import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseMarkersJson, parseTakeJson } from '@cuttle/project';
import { importTake } from '../src/import';
import { runFfmpeg } from '../src/ffmpeg';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-import-'));
  dirs.push(dir);
  return dir;
};

/** A video as a phone or another tool makes one: 25 fps, BT.601 (ffmpeg's default), with a tone unless `sound` is false. */
const source = (file: string, seconds: number, { size = '640x360', sound = true } = {}) =>
  runFfmpeg([
    '-f', 'lavfi', '-i', `testsrc2=s=${size}:r=25:d=${seconds}`,
    ...(sound ? ['-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=44100:duration=${seconds}`, '-c:a', 'aac'] : []),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', file,
  ]);

/** The first video stream of `file` and the times of its key frames, as ffprobe reads them. */
function probe(file: string) {
  const run = (args: string[]) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-of', 'json', ...args, file], { encoding: 'utf8' }).stdout);
  const stream = run(['-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,color_space,color_primaries,color_transfer,color_range']).streams[0];
  const keys = run(['-select_streams', 'v:0', '-skip_frame', 'nokey', '-show_entries', 'frame=pts_time']).frames.map((frame: { pts_time: string }) => Number(frame.pts_time));
  return { ...stream, keys };
}

const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

describe('importTake', () => {
  it('imports a video as the next take, as the recorder writes one (30 fps, BT.709, a key frame every 2 s), its sound as the mic, and the project uses it', async () => {
    const project = temp();
    const file = join(temp(), 'phone.mp4');
    await source(file, 4.4);

    const result = await importTake(project, file);
    // 4.4 s (110 frames at 25 fps): 132 frames at 30 fps, to the end of the last one
    expect(result).toMatchObject({ take: 'takes/1', file, seconds: 4.4, width: 640, height: 360, tracks: ['screen', 'mic'] });
    expect(result.backup).toBeUndefined();
    const take = join(project, 'takes', '1');
    expect(probe(join(take, 'screen.mp4'))).toEqual({
      width: 640,
      height: 360,
      r_frame_rate: '30/1',
      color_space: 'bt709',
      color_primaries: 'bt709',
      color_transfer: 'bt709',
      color_range: 'tv',
      keys: [0, 2, 4],
    });
    // picture and sound start together; no input and no markers, but files the take's readers accept
    const parsed = parseTakeJson(readFileSync(join(take, 'take.json'), 'utf8'));
    expect(parsed.ok && parsed.take.tracks).toEqual({ screen: { file: 'screen.mp4', start: expect.any(Number) }, mic: { file: 'mic.m4a', start: parsed.ok ? parsed.take.tracks.screen.start : 0 } });
    expect(readFileSync(join(take, 'events.jsonl'), 'utf8')).toBe('');
    expect(parseMarkersJson(readFileSync(join(take, 'markers.json'), 'utf8')).ok).toBe(true);
    // the project was made, and is one clip over the take
    const written = json(join(project, 'cuttle.json'));
    expect(written.sources).toEqual({ screen: 'takes/1/screen.mp4', mic: 'takes/1/mic.m4a', events: 'takes/1/events.jsonl', markers: 'takes/1/markers.json' });
    expect(written.scenes).toEqual([{ type: 'clip', from: 0, to: Math.floor(result.seconds * 1000) / 1000 }]);
  }, 60_000);

  it('takes a stretch of the file as the next take; the edit of the previous one stays in the backup', async () => {
    const project = temp();
    const file = join(temp(), 'long.mov');
    await source(file, 5);
    await importTake(project, file);

    const result = await importTake(project, file, { from: 1, to: 3.5 });
    expect(result.take).toBe('takes/2');
    expect(result.seconds).toBeCloseTo(2.5, 1);
    expect(result.backup).toBeDefined();
    expect(json(result.backup!).sources.screen).toBe('takes/1/screen.mp4');
    expect(json(join(project, 'cuttle.json')).sources.screen).toBe('takes/2/screen.mp4');
    // a stretch to past the end ends at the end: the file's last frame, at 30 fps (a frame or two short of 1 s)
    for (const to of [undefined, 99]) {
      const seconds = (await importTake(project, file, { from: 4, ...(to !== undefined && { to }) })).seconds;
      expect(seconds).toBeGreaterThan(0.9);
      expect(seconds).toBeLessThanOrEqual(1);
    }
  }, 60_000);

  it('scales a picture larger than 4K down to it, and a video without sound has no mic', async () => {
    const project = temp();
    const file = join(temp(), 'wide.mp4');
    await source(file, 1, { size: '4000x2000', sound: false });

    const result = await importTake(project, file);
    expect(result).toMatchObject({ width: 3840, height: 1920, tracks: ['screen'] });
    expect(existsSync(join(project, 'takes', '1', 'mic.m4a'))).toBe(false);
    expect(json(join(project, 'cuttle.json')).sources.mic).toBeUndefined();
  }, 60_000);

  it('refuses a missing file, a file without video and a start past the end, and leaves no take behind', async () => {
    const project = temp();
    const sound = join(temp(), 'tone.m4a');
    await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'aac', '-y', sound]);
    const file = join(temp(), 'short.mp4');
    await source(file, 2);

    await expect(importTake(project, join(project, 'nothing.mp4'))).rejects.toMatchObject({ code: 'missing-file' });
    await expect(importTake(project, sound)).rejects.toMatchObject({ code: 'invalid-media', message: expect.stringContaining('has no video') });
    await expect(importTake(project, file, { from: 5 })).rejects.toMatchObject({ code: 'usage', message: expect.stringContaining('past the end') });
    await expect(importTake(project, file, { from: 1, to: 1 })).rejects.toMatchObject({ code: 'usage' });
    expect(existsSync(join(project, 'takes')) ? readdirSync(join(project, 'takes')) : []).toEqual([]);
  }, 60_000);
});
