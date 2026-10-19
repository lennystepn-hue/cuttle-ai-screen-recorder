import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ffmpegPath, spawnCapture, type CaptureProcess, type Feeder } from '../src/ffmpeg';
import { relayInput } from '../src/window-capture';

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

  describe('relaying a feeder that sends a frame only when the picture changes', () => {
    const size = { width: 64, height: 36 };
    /** Raw frames of a test pattern at `rate` a second, for `seconds` (or until killed). */
    const feeder = (rate: number, seconds = ''): Feeder => ({
      command: ffmpegPath(),
      args: ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=s=64x36:r=${rate}${seconds},realtime,format=bgra`, '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1'],
      frameBytes: size.width * size.height * 4,
    });
    const frames = (file: string) =>
      Number(spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout);
    const relayed = (file: string) => ['-use_wallclock_as_timestamps', '1', ...relayInput(size), ...out(file)];
    const running = (pid: number | undefined) => {
      if (pid === undefined) return false;
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    /**
     * Waits for one step of a relayed capture, at most `seconds`. Once it hung on GitHub's Windows
     * runner (the test's 15 s ran out, twice in a row) and never here: a step that stalls fails at
     * once, saying which one, whether ffmpeg and its feeder still run, and ffmpeg's last lines.
     */
    const step = async <T,>(what: string, promise: Promise<T>, capture: CaptureProcess, lines: readonly string[], seconds: number): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stalled = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const state = `ffmpeg ${running(capture.pid) ? 'still runs' : 'has exited'}, its feeder ${running(capture.feederPid) ? 'still runs' : 'has exited'}`;
          for (const pid of [capture.pid, capture.feederPid]) if (running(pid)) process.kill(pid!);
          reject(new Error(`${what} took over ${seconds} s; ${state}. ffmpeg's last lines:\n${lines.slice(-20).join('\n')}`));
        }, seconds * 1000);
      });
      try {
        return await Promise.race([promise, stalled]);
      } finally {
        clearTimeout(timer);
      }
    };

    it('writes 30 frames a second from 2 a second, and stops at once though no frame is coming', async () => {
      const file = join(temp('cuttle-relay-'), 'out.mp4');
      const capture = spawnCapture('screen', relayed(file), feeder(2));
      const lines: string[] = [];
      capture.onLine((line) => lines.push(line));
      await step('the start', capture.started, capture, lines, 8);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const asked = Date.now();
      await step('the stop', capture.stop(), capture, lines, 4);
      expect(Date.now() - asked).toBeLessThan(2000);
      const seconds = duration(file);
      expect(seconds).toBeGreaterThan(1.3);
      // Far more than the feeder's 2 a second: the relay writes them. Beside a hundred other test
      // files the clock's ticks come late, and a late tick writes one frame (full runs measured 24.6
      // and 18.8 a second), so only that is asked: at least five times what the feeder sends.
      expect(frames(file) / seconds).toBeGreaterThan(10);
      expect(frames(file) / seconds).toBeLessThan(33);
    }, 15_000);

    it('says when the feeder ended after its first frame (the window was closed), and writes its last frame on until stop()', async () => {
      const file = join(temp('cuttle-relay-'), 'out.mp4');
      const capture = spawnCapture('screen', relayed(file), feeder(10, ':d=0.5'));
      const start = await capture.started;
      await capture.ended;
      expect(Date.now() / 1000 - start).toBeGreaterThan(0.3);
      await new Promise((resolve) => setTimeout(resolve, 700));
      await capture.stop();
      expect(duration(file)).toBeGreaterThan(1);
    }, 15_000);

    it("fails with the feeder's log when it ends before its first frame", async () => {
      const capture = spawnCapture('screen', relayed(join(temp('cuttle-relay-'), 'out.mp4')), { command: ffmpegPath(), args: ['-hide_banner', '-f', 'lavfi', '-i', 'no_such_window', '-f', 'rawvideo', 'pipe:1'], frameBytes: 64 * 36 * 4 });
      await expect(capture.exited).rejects.toMatchObject({ code: 'capture', message: expect.stringContaining('no_such_window') });
    }, 15_000);
  });

  it('fails when ffmpeg cannot open its input, before any start time', async () => {
    const capture = spawnCapture('mic', ['-f', 'lavfi', '-i', 'no_such_source', '-f', 'null', '-']);
    await expect(capture.started).rejects.toMatchObject({ code: 'capture', message: expect.stringContaining('no_such_source') });
  });
});
