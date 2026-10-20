// The editor's proxy, made with ffmpeg from a take as macOS's capture helper writes one: a frame
// when the screen changes, at microseconds, and none while it holds still.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { proxyArgs } from '../src/shared/media-jobs';

const dir = mkdtempSync(join(tmpdir(), 'cuttle-proxy-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(tool: string, args: string[]): string {
  const result = spawnSync(tool, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${tool} failed: ${result.stderr}`);
  return result.stdout;
}

const frameTimes = (file: string) =>
  run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', file])
    .trim()
    .split(/\r?\n/)
    .map(Number)
    .sort((a, b) => a - b);

describe('the proxy', () => {
  it('keeps the frame times of a take at irregular microseconds, also after a still stretch', () => {
    const take = join(dir, 'screen.mp4');
    // 30 frames, 2 s without one (a still screen), 60 more; each up to 20 ms late
    run('ffmpeg', [
      '-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=320x180:r=30:d=3',
      '-vf', "settb=1/1000000,setpts='trunc(N*33333+gte(N\\,30)*2000000+random(0)*20000)'",
      '-fps_mode', 'passthrough', '-c:v', 'libx264', '-preset', 'ultrafast', '-enc_time_base', '1/1000000', '-video_track_timescale', '1000000', take,
    ]);
    const proxy = join(dir, 'proxy.mp4');
    run('ffmpeg', proxyArgs(take, proxy));
    const source = frameTimes(take);
    const made = frameTimes(proxy);
    expect(made).toHaveLength(source.length);
    for (const [k, time] of made.entries()) expect(Math.abs(time - source[k]!)).toBeLessThan(0.001);
  });
});
