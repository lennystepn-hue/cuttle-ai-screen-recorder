import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { alphaMuxArgs } from '../../src/audio';

const dir = mkdtempSync(join(tmpdir(), 'cuttle-alpha-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ffmpeg = (args: string[]) => {
  const ran = spawnSync(process.env.CUTTLE_FFMPEG || 'ffmpeg', args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  expect(ran.status, ran.stderr?.toString().slice(-2000)).toBe(0);
  return ran.stdout;
};

/** A frame's alpha at a point, decoded as the editor at the other end reads it. */
const alphaAt = (file: string, decoder: string[], x: number, y: number) => {
  const rgba = ffmpeg(['-hide_banner', '-v', 'error', ...decoder, '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
  return rgba[(y * 320 + x) * 4 + 3];
};

describe('a transparent video', () => {
  it('keeps its alpha through the WebM it is copied into and the ProRes 4444 it becomes', () => {
    // what the page writes: VP9 with alpha in WebM, a white box on nothing
    const video = join(dir, 'video.webm');
    ffmpeg(['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=320x180:d=1', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=1,drawbox=x=100:y=50:w=120:h=80:color=white:t=fill,format=gray', '-filter_complex', '[0][1]alphamerge,format=yuva420p', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', video]);
    const mix = join(dir, 'mix.wav');
    ffmpeg(['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=d=1:sample_rate=48000', '-c:a', 'pcm_f32le', mix]);
    for (const container of ['webm', 'mov'] as const) {
      const out = join(dir, `out.${container}`);
      ffmpeg(alphaMuxArgs({ video, audio: mix, container, out }));
      const decoder = container === 'webm' ? ['-c:v', 'libvpx-vp9'] : [];
      expect([alphaAt(out, decoder, 5, 5), alphaAt(out, decoder, 160, 90)], container).toEqual([0, 255]);
    }
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,profile', '-of', 'csv=p=0', join(dir, 'out.mov')], { encoding: 'utf8', windowsHide: true }).stdout.trim().split(/\r?\n/);
    expect(probe).toEqual(['prores,4444', 'pcm_s16le,unknown']);
  });
});
