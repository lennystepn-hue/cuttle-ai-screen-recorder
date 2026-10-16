import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkFfmpeg, ffmpegPath, runFfmpeg } from '../../src/main/ffmpeg';

const hasFfmpeg = spawnSync(ffmpegPath(), ['-version'], { windowsHide: true }).status === 0;

afterEach(() => vi.unstubAllEnvs());

describe('ffmpeg', () => {
  it('runs ffmpeg from PATH unless CUTTLE_FFMPEG names another one', () => {
    vi.stubEnv('CUTTLE_FFMPEG', '');
    expect(ffmpegPath()).toBe('ffmpeg');
    vi.stubEnv('CUTTLE_FFMPEG', 'C:/tools/ffmpeg.exe');
    expect(ffmpegPath()).toBe('C:/tools/ffmpeg.exe');
  });

  it('says how to install ffmpeg when it is missing', async () => {
    vi.stubEnv('CUTTLE_FFMPEG', join(tmpdir(), 'no-such-ffmpeg'));
    await expect(checkFfmpeg()).rejects.toMatchObject({
      name: 'ExportError',
      code: 'ffmpeg-missing',
      message: expect.stringContaining('winget install Gyan.FFmpeg'),
    });
  });

  it.runIf(hasFfmpeg)('stops ffmpeg when the export is cancelled', async () => {
    const controller = new AbortController();
    // A minute of audio rendered in real time (-re): it would run for a minute unless stopped.
    const running = runFfmpeg(['-v', 'error', '-re', '-f', 'lavfi', '-i', 'sine=duration=60', '-f', 'null', '-'], controller.signal);
    setTimeout(() => controller.abort(), 200);
    const started = performance.now();
    await expect(running).rejects.toMatchObject({ name: 'ExportError', code: 'cancelled' });
    expect(performance.now() - started).toBeLessThan(10_000);
  });

  it('does not start ffmpeg for an export that is already cancelled', async () => {
    await expect(runFfmpeg(['-version'], AbortSignal.abort())).rejects.toMatchObject({ code: 'cancelled' });
  });
});
