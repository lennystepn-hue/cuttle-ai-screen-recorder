import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasWindowCapture, relayInput, testWindowFeeder, windowFeeder } from '../src/window-capture';

afterEach(() => vi.unstubAllEnvs());

describe('window capture', () => {
  it('reads the window with gfxcapture: its frame at an even size, without the yellow border, the pointer when asked', () => {
    vi.stubEnv('CUTTLE_FFMPEG', '');
    expect(windowFeeder(198788, { width: 800, height: 500 }, false)).toEqual({
      command: 'ffmpeg',
      args: [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
        '-i', 'gfxcapture=hwnd=198788:capture_cursor=0:capture_border=1:display_border=0:max_framerate=30:width=800:height=500,hwdownload,format=bgra',
        '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1',
      ],
      frameBytes: 800 * 500 * 4,
    });
    expect(windowFeeder(1, { width: 2, height: 2 }, true).args[6]).toContain('capture_cursor=1');
    expect(relayInput({ width: 800, height: 500 })).toEqual(['-f', 'rawvideo', '-pixel_format', 'bgra', '-video_size', '800x500', '-framerate', '1000000', '-i', 'pipe:0']);
  });

  it("gives the test backend's window a test pattern, which closes after CUTTLE_TEST_WINDOW_CLOSES seconds", () => {
    expect(testWindowFeeder({ width: 640, height: 360 }).args[6]).toBe('testsrc2=s=640x360:r=10,realtime,format=bgra');
    vi.stubEnv('CUTTLE_TEST_WINDOW_CLOSES', '1.5');
    expect(testWindowFeeder({ width: 640, height: 360 }).args[6]).toBe('testsrc2=s=640x360:r=10:d=1.5,realtime,format=bgra');
  });

  it('asks ffmpeg once whether it has gfxcapture; a missing ffmpeg has not', async () => {
    const missing = join(tmpdir(), 'no-such-ffmpeg');
    expect(hasWindowCapture(missing)).toBe(hasWindowCapture(missing));
    expect(await hasWindowCapture(missing)).toBe(false);
  });

  // ffmpeg 8 brought gfxcapture (Gyan's builds say "8.0-full_build-www.gyan.dev")
  const major = Number(/ffmpeg version n?(\d+)\./.exec(spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).stdout ?? '')?.[1]);
  it.runIf(process.platform === 'win32' && major >= 8)('finds gfxcapture in ffmpeg 8 and newer on Windows', async () => {
    expect(await hasWindowCapture('ffmpeg')).toBe(true);
  });
});
