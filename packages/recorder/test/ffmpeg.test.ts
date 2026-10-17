import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ffmpegPath, spawnCapture } from '../src/ffmpeg';

afterEach(() => vi.unstubAllEnvs());
const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

const duration = (file: string) =>
  Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout);
const testsrc = (seconds = '') => ['-use_wallclock_as_timestamps', '1', '-f', 'lavfi', '-i', `testsrc2=s=320x240:r=30${seconds},realtime,settb=1/1000000`];
const out = (file: string) => ['-c:v', 'libx264', '-preset', 'ultrafast', '-f', 'mp4', '-y', file];

describe('spawnCapture', () => {
  it('runs ffmpeg from PATH unless CUTTLE_FFMPEG names another one', () => {
    vi.stubEnv('CUTTLE_FFMPEG', '');
    expect(ffmpegPath()).toBe('ffmpeg');
    vi.stubEnv('CUTTLE_FFMPEG', 'C:/tools/ffmpeg.exe');
    expect(ffmpegPath()).toBe('C:/tools/ffmpeg.exe');
  });

  it('says how to install ffmpeg when it is missing', async () => {
    vi.stubEnv('CUTTLE_FFMPEG', join(tmpdir(), 'no-such-ffmpeg'));
    const capture = spawnCapture('screen', ['-version']);
    const missing = expect.objectContaining({ name: 'RecorderError', code: 'ffmpeg-missing', message: expect.stringContaining('winget install Gyan.FFmpeg') });
    await expect(capture.started).rejects.toEqual(missing);
    await expect(capture.exited).rejects.toEqual(missing);
  });

  it('reports the wall clock of the first frame and finishes the file on stop', async () => {
    const file = join(temp('cuttle-ffmpeg-'), 'out.mp4');
    const before = Date.now() / 1000;
    const capture = spawnCapture('screen', [...testsrc(), ...out(file)]);
    const start = await capture.started;
    expect(start).toBeGreaterThanOrEqual(before - 0.05);
    expect(start).toBeLessThan(Date.now() / 1000 + 0.002); // Date.now() drops the microseconds ffmpeg has
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await capture.stop();
    expect(capture.seconds()).toBeGreaterThan(0.8);
    expect(duration(file)).toBeCloseTo(capture.seconds()!, 1);
  });

  it('passes every stderr line to listeners', async () => {
    const capture = spawnCapture('screen', [...testsrc(':d=0.5'), '-f', 'null', '-']);
    const lines: string[] = [];
    capture.onLine((line) => lines.push(line));
    await capture.exited.catch(() => {});
    expect(lines.some((line) => line.includes('Stream #0:0'))).toBe(true);
  });

  it('fails when ffmpeg ends before stop() was called, with the end of its log', async () => {
    const capture = spawnCapture('webcam', [...testsrc(':d=0.5'), '-f', 'null', '-']);
    await expect(capture.exited).rejects.toMatchObject({ code: 'capture', message: expect.stringMatching(/^the webcam capture stopped unexpectedly \(ffmpeg exit code 0\):\n/) });
  });

  it('fails when ffmpeg cannot open its input, before any start time', async () => {
    const capture = spawnCapture('mic', ['-f', 'lavfi', '-i', 'no_such_source', '-f', 'null', '-']);
    await expect(capture.started).rejects.toMatchObject({ code: 'capture', message: expect.stringContaining('no_such_source') });
  });
});
