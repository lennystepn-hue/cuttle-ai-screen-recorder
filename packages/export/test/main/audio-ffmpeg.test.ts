import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseProject } from '@cuttle/project';
import { sceneSpans, typingClicks } from '@cuttle/timeline';
import { describe, expect, it } from 'vitest';
import { audioFilterGraph, planAudio } from '../../src/audio';
import { ffmpegPath } from '../../src/main/ffmpeg';
import { writeTypingTrack } from '../../src/main/typing-track';

const hasFfmpeg = spawnSync(ffmpegPath(), ['-version'], { windowsHide: true }).status === 0;

/** A 440 Hz sine "mic" for 20 s. */
const SINE = 'sine=frequency=440:sample_rate=48000:duration=20';

/** Renders the export's audio for `scenes` from the lavfi "mic" `mic` and returns its first channel. */
function render(scenes: unknown[], seconds: number, look: Record<string, unknown> = {}, mic = SINE): Float32Array {
  const parsed = parseProject({ version: 1, sources: { screen: 's.mp4', mic: 'm.m4a' }, scenes, look });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const segments = planAudio({ spans: sceneSpans(parsed.project.scenes), look: parsed.project.look, mic: true, seconds });
  const graph = audioFilterGraph(segments, 0, 0);
  const result = spawnSync(
    ffmpegPath(),
    ['-v', 'error', '-f', 'lavfi', '-i', mic, '-filter_complex', graph, '-map', '[aout]', '-f', 'f32le', '-'],
    { maxBuffer: 64 * 1024 * 1024, windowsHide: true },
  );
  if (result.status !== 0) throw new Error(result.stderr.toString());
  const stereo = new Float32Array(result.stdout.buffer, result.stdout.byteOffset, result.stdout.byteLength / 4);
  return stereo.filter((_, i) => i % 2 === 0);
}

function peak(samples: Float32Array, from: number, to: number): number {
  let max = 0;
  for (let i = from; i < to; i++) max = Math.max(max, Math.abs(samples[i]!));
  return max;
}

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

  it('plays nothing from after the cut, also for sped-up and slowed-down clips', () => {
    // The mic is silent up to 11 s, where the clip ends, and loud after it: the clip must stay silent.
    const loudAfterCut = "aevalsrc='if(gte(t,11),0.8*sin(2*PI*440*t),0)':s=48000:d=20";
    for (const speed of [1.5, 2, 0.5, 0.25]) {
      const length = Math.round((8 / speed) * 30) / 30;
      const audio = render(
        [{ type: 'clip', from: 3, to: 11, speed }],
        length,
        { audio: { muteSpedUp: false }, transition: { enabled: false } },
        loudAfterCut,
      );

      expect(peak(audio, 0, audio.length), `speed ${speed}`).toBeLessThan(0.01);
    }
  });

  it('plays a split clip exactly like the whole clip, at any speed: no dip or click at a continuous cut', () => {
    const loud = { audio: { muteSpedUp: false } };
    for (const [speed, split] of [[1, 2.5], [0.5, 1.5], [2, 3.7], [3, 4.4]] as const) {
      const seconds = Math.round((8 / speed) * 30) / 30;
      const whole = render([{ type: 'clip', from: 1, to: 9, speed }], seconds, loud);
      const cut = render([{ type: 'clip', from: 1, to: split, speed }, { type: 'clip', from: split, to: 9, speed }], seconds, loud);
      expect(cut.length, `speed ${speed}`).toBe(whole.length);
      let worst = 0;
      for (let i = 0; i < whole.length; i++) worst = Math.max(worst, Math.abs(cut[i]! - whole[i]!));
      expect(worst, `speed ${speed}`).toBeLessThan(1e-4);
    }
  });

  it('mixes the typing sounds in where a key was typed: without a mic, and over one at its own level', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuttle-typing-mix-'));
    try {
      const parsed = parseProject({ version: 1, sources: { screen: 's.mp4', mic: 'm.m4a' }, scenes: [{ type: 'clip', from: 0, to: 3 }], look: { transition: { enabled: false } } });
      if (!parsed.ok) throw new Error('invalid');
      const spans = sceneSpans(parsed.project.scenes);
      const clicks = typingClicks(spans, [{ t: 1, type: 'keys', count: 1 }], parsed.project.look.audio);
      const wav = join(dir, 'typing.wav');
      await writeTypingTrack(wav, clicks, 1, 3);
      const at = Math.round(clicks[0]!.at * 48_000);
      const mix = (inputs: string[], mic: boolean, typingInput: number) => {
        const segments = planAudio({ spans, look: parsed.project.look, mic, seconds: 3 });
        const result = spawnSync(ffmpegPath(), ['-v', 'error', ...inputs, '-filter_complex', audioFilterGraph(segments, 0, 0, typingInput), '-map', '[aout]', '-f', 'f32le', '-'], {
          maxBuffer: 64 * 1024 * 1024,
          windowsHide: true,
        });
        if (result.status !== 0) throw new Error(result.stderr.toString());
        const stereo = new Float32Array(result.stdout.buffer, result.stdout.byteOffset, result.stdout.byteLength / 4);
        return stereo.filter((_, i) => i % 2 === 0);
      };
      // no mic: silence, and the click where the key was typed
      const alone = mix(['-i', wav], false, 0);
      expect(alone.length).toBe(3 * 48_000);
      expect(peak(alone, 0, at - 10)).toBe(0);
      expect(peak(alone, at, at + 4800)).toBeGreaterThan(0.3);
      expect(peak(alone, at + 9600, alone.length)).toBe(0);
      // over the sine mic: the click on top, and the mic as loud as without it (amix does not halve it)
      const over = mix(['-f', 'lavfi', '-i', SINE, '-i', wav], true, 1);
      expect(peak(over, at, at + 4800)).toBeGreaterThan(peak(over, 48_000 * 2, 48_000 * 2.5) + 0.2);
      expect(peak(over, 48_000 * 2, 48_000 * 2.5)).toBeCloseTo(0.125, 2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
