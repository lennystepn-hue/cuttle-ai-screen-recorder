import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkFfmpeg, ffmpegPath } from '../../src/main/ffmpeg';

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
});
