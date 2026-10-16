import { spawnSync } from 'node:child_process';
import { parseProject } from '@cuttle/project';
import { sceneSpans } from '@cuttle/timeline';
import { describe, expect, it } from 'vitest';
import { audioFilterGraph, planAudio } from '../../src/audio';
import { ffmpegPath } from '../../src/main/ffmpeg';

const hasFfmpeg = spawnSync(ffmpegPath(), ['-version'], { windowsHide: true }).status === 0;

/** Renders the export's audio for `scenes` from a 440 Hz sine "mic" and returns its first channel. */
function render(scenes: unknown[], seconds: number, look: Record<string, unknown> = {}): Float32Array {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4', mic: 'm.m4a' }, scenes, look });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const segments = planAudio({ spans: sceneSpans(parsed.project.scenes), look: parsed.project.look, mic: true, seconds });
  const graph = audioFilterGraph(segments, 0, 0);
  const result = spawnSync(
    ffmpegPath(),
    ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=20', '-filter_complex', graph, '-map', '[aout]', '-f', 'f32le', '-'],
    { maxBuffer: 64 * 1024 * 1024, windowsHide: true },
  );
  if (result.status !== 0) throw new Error(result.stderr.toString());
  const stereo = new Float32Array(result.stdout.buffer, result.stdout.byteOffset, result.stdout.byteLength / 4);
  return stereo.filter((_, i) => i % 2 === 0);
}

const peak = (samples: Float32Array, from: number, to: number) => Math.max(...samples.subarray(from, to).map(Math.abs));

describe.runIf(hasFfmpeg)('export audio through ffmpeg', () => {
  it('fades out to silence where the last clip ends, between two frames', () => {
    // 1.51 s of clip at 30 fps: the video runs to frame 46 (1.5333 s), the mic content ends at 72 480 samples.
    const audio = render([{ type: 'clip', from: 1, to: 2.51 }], 46 / 30);
    expect(audio.length).toBe(73_600);
    expect(peak(audio, 70_000, 71_000)).toBeGreaterThan(0.1);
    expect(peak(audio, 72_480 - 24, 73_600)).toBeLessThan(0.01);
  });

  it('fills a sped-up clip to its end and fades out there', () => {
    // 8 s at 4× is 96 000 samples; atempo alone returns about 768 fewer, which used to cut off unfaded.
    const audio = render([{ type: 'clip', from: 3, to: 11, speed: 4 }], 2, { audio: { muteSpedUp: false }, transition: { enabled: false } });
    expect(audio.length).toBe(96_000);
    expect(peak(audio, 96_000 - 600, 96_000 - 480)).toBeGreaterThan(0.1); // still sound right before the fade
    expect(peak(audio, 96_000 - 24, 96_000)).toBeLessThan(0.01);
  });
});
