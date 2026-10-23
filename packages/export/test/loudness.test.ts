import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOUDNESS } from '@cuttle/project';
import { afterAll, describe, expect, it } from 'vitest';
import { CODEC_HEADROOM, masterGraph, meteredGraph, parseMeter } from '../src/audio';

const dir = mkdtempSync(join(tmpdir(), 'cuttle-loudness-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ffmpeg = (args: string[]) => {
  const ran = spawnSync(process.env.CUTTLE_FFMPEG || 'ffmpeg', ['-hide_banner', '-nostdin', '-nostats', ...args], { encoding: 'utf8', windowsHide: true });
  expect(ran.status, ran.stderr.slice(-2000)).toBe(0);
  return ran.stderr;
};

describe('masterGraph', () => {
  it('adds a gain and a limiter after the mix, its output still [aout]', () => {
    expect(masterGraph('[0:a]anull[aout]', 6.5, -1)).toBe(
      `[0:a]anull[premaster];[premaster]volume=6.50dB,aresample=192000,alimiter=limit=${(10 ** ((-1 - CODEC_HEADROOM) / 20)).toFixed(4)}:attack=1:release=60:level=false,aresample=48000[aout]`,
    );
    expect(() => masterGraph('[0:a]anull[x]', 0, -1)).toThrow();
  });
});

describe('parseMeter', () => {
  it('reads the summary ffmpeg prints last, and silence as none', () => {
    const summary = '[Parsed_ebur128_0 @ 0x1] Summary:\n\n  Integrated loudness:\n    I:         -31.8 LUFS\n    Threshold: -41.8 LUFS\n\n  True peak:\n    Peak:      -28.1 dBFS\n';
    expect(parseMeter(`frame lines I: -20.0 LUFS\n${summary}`)).toEqual({ lufs: -31.8, truePeak: -28.1 });
    expect(parseMeter(summary.replace('-31.8', '-70.0').replace('-28.1', '-inf'))).toEqual({ lufs: -70, truePeak: null });
    expect(parseMeter('no meter')).toEqual({ lufs: null, truePeak: null });
  });
});

describe('the loudness of a mix', () => {
  it('brings a quiet mix to a platform’s level within 1 LU, its true peak under the ceiling after AAC', () => {
    // a quiet mix: pink noise, about -30 LUFS
    const source = ['-f', 'lavfi', '-i', 'anoisesrc=d=10:c=pink:r=48000:a=0.03:s=7'];
    const graph = '[0:a]aformat=sample_fmts=fltp:channel_layouts=stereo[aout]';
    const mix = parseMeter(ffmpeg([...source, '-filter_complex', meteredGraph(graph), '-map', '[meter]', '-f', 'null', '-']));
    expect(mix.lufs).toBeLessThan(-25);
    for (const target of ['youtube', 'podcast'] as const) {
      const { lufs, truePeak } = LOUDNESS[target];
      const out = join(dir, `${target}.m4a`);
      ffmpeg(['-y', ...source, '-filter_complex', masterGraph(graph, lufs - mix.lufs!, truePeak), '-map', '[aout]', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', out]);
      const heard = parseMeter(ffmpeg(['-i', out, '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-']));
      expect(Math.abs(heard.lufs! - lufs), `${target}: ${heard.lufs} LUFS`).toBeLessThan(1);
      expect(heard.truePeak!, `${target}: ${heard.truePeak} dBTP`).toBeLessThanOrEqual(truePeak);
    }
  });
});
