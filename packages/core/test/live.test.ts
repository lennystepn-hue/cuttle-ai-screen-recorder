import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normWord } from '@cuttle/project';
import { ffmpegPath, runFfmpeg } from '../src/ffmpeg';
import { LIVE_RATE, liveCaptions, quietestCut, withoutEchoes, type LiveMode } from '../src/speech/live';
import type { HeardWord } from '../src/speech/whisper';

/**
 * Real live captions run where a speech model is downloaded (`CUTTLE_TEST_MODELS`, else the user's
 * models folder; `base` first, the fastest) and ffmpeg has the whisper filter; they are skipped elsewhere.
 */
const modelsDir = process.env.CUTTLE_TEST_MODELS || (process.platform === 'win32' ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Cuttle', 'models') : join(homedir(), 'Library', 'Application Support', 'Cuttle', 'models'));
const model = ['base', 'small', 'large-v3-turbo-q5_0'].map((name) => join(modelsDir, `ggml-${name}.bin`)).find((file) => existsSync(file));
const whisper = / whisper /.test(spawnSync(ffmpegPath(), ['-hide_banner', '-filters'], { encoding: 'utf8', windowsHide: true }).stdout ?? '');
const SPEECH = join(import.meta.dirname, 'fixtures', 'speech', 'en.m4a');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `seconds` of 16 kHz samples: a sine at `amplitude` of full scale, or silence. */
function tone(seconds: number, amplitude: number): Uint8Array {
  const count = Math.round(seconds * LIVE_RATE);
  const bytes = new Uint8Array(count * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < count; i++) view.setInt16(i * 2, Math.round(Math.sin((2 * Math.PI * 220 * i) / LIVE_RATE) * amplitude * 32767), true);
  return bytes;
}

const join2 = (...parts: Uint8Array[]) => Uint8Array.from(Buffer.concat(parts));

describe('quietestCut', () => {
  it('cuts a window in its quietest tenth of a second between 3 and 5 s', () => {
    const samples = join2(tone(3.6, 0.3), tone(0.1, 0.02), tone(0.1, 0), tone(1.6, 0.3));
    // the silence from 3.7 s: its tenth's middle, in bytes
    expect(quietestCut(samples) / 2 / LIVE_RATE).toBeCloseTo(3.75, 5);
  });

  it('takes the latest of equally quiet tenths, so a steady sound gets the longest window', () => {
    expect(quietestCut(tone(6, 0.3)) / 2 / LIVE_RATE).toBeCloseTo(4.95, 5);
  });
});

describe('withoutEchoes', () => {
  const word = (t: number, end: number, text: string): HeardWord => ({ t, end, text });

  it("drops a word heard again at a window's edge, and keeps a word said twice", () => {
    const last = word(9.7, 9.94, 'you.');
    expect(withoutEchoes([word(9.92, 10.42, 'you.'), word(10.5, 10.8, 'It')], last)).toEqual([word(10.5, 10.8, 'It')]);
    // "that that": the second starts well after the first ends
    expect(withoutEchoes([word(1, 1.2, 'that'), word(1.6, 1.8, 'that')], undefined)).toHaveLength(2);
    // a different word right after
    expect(withoutEchoes([word(9.92, 10.1, 'your')], last)).toEqual([word(9.92, 10.1, 'your')]);
  });
});

/** The spoken fixture as 16 kHz samples. */
async function spokenSamples(): Promise<Uint8Array> {
  const { stdout } = await runFfmpeg(['-i', SPEECH, '-ar', String(LIVE_RATE), '-ac', '1', '-f', 's16le', 'pipe:1']);
  return Uint8Array.from(stdout);
}

/** Pushes the samples at twice their speed (a fifth of a second every tenth), then 6 s of quiet. */
async function caption(mode: LiveMode): Promise<{ words: HeardWord[]; errors: Error[] }> {
  const samples = await spokenSamples();
  const words: HeardWord[] = [];
  const errors: Error[] = [];
  const live = liveCaptions({ model: model!, language: 'en', mode, onWords: (heard) => words.push(...heard), onError: (error) => errors.push(error) });
  const piece = LIVE_RATE * 2 * 0.2;
  for (let i = 0; i < samples.length; i += piece) {
    live.push(samples.subarray(i, i + piece));
    await sleep(100);
  }
  // then quiet, so the last window is heard
  for (let i = 0; i < 30; i++) {
    live.push(new Uint8Array(piece));
    await sleep(100);
  }
  live.stop();
  return { words, errors };
}

describe.runIf(model !== undefined && whisper)('liveCaptions (a real model)', () => {
  it.each<LiveMode>(['stream', 'windows'])('hears the spoken fixture as it is pushed (%s)', async (mode) => {
    const { words, errors } = await caption(mode);
    expect(errors).toEqual([]);
    const said = words.map((word) => normWord(word.text));
    for (const expected of ['screen', 'video', 'click', 'pauses']) expect(said).toContain(expected);
    // in the order said, in seconds of the sound pushed (18.7 s of speech)
    expect(words.every((word, i) => i === 0 || word.t >= words[i - 1]!.t - 0.5)).toBe(true);
    expect(words.at(-1)!.t).toBeLessThan(21);
  }, 90_000);

  it('tells once when whisper fails, and the captions end', async () => {
    const errors: Error[] = [];
    const live = liveCaptions({ model: join(modelsDir, 'no-such-model.bin'), language: 'en', onWords: () => {}, onError: (error) => errors.push(error) });
    for (let i = 0; i < 20 && errors.length === 0; i++) {
      live.push(tone(0.1, 0.1));
      await sleep(100);
    }
    live.push(tone(0.1, 0.1));
    live.stop();
    expect(errors).toEqual([expect.objectContaining({ code: 'invalid-media', message: expect.stringMatching(/^the live captions stopped/) })]);
  }, 30_000);
});
