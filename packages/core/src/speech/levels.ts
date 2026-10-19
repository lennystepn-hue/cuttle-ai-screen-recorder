// Where the mic hears someone: the track's loudness every 10 ms, and the stretches clearly louder
// than its quiet floor. No model needed; `suggest` keeps speech, and the alignment places words in
// these stretches.
import { spawn } from 'node:child_process';
import { CoreError } from '../errors';
import { ffmpegPath } from '../ffmpeg';
import type { Span } from '../suggest/spans';

/** Seconds per loudness value. */
export const LEVEL_SECONDS = 0.01;
const RATE = 8000;
const WINDOW = RATE * LEVEL_SECONDS;
/** Quieter than this counts as this (digital silence has no level). */
const FLOOR_DB = -100;

/** The loudness of the first audio stream every `LEVEL_SECONDS`, in dB of full scale (RMS). */
export function micLevels(path: string, signal?: AbortSignal): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', path, '-map', '0:a:0', '-ac', '1', '-ar', String(RATE), '-f', 's16le', 'pipe:1'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    const levels: number[] = [];
    let sum = 0;
    let count = 0;
    let odd: number | undefined;
    const sample = (value: number) => {
      sum += value * value;
      if (++count === WINDOW) {
        levels.push(toDb(sum / count));
        sum = 0;
        count = 0;
      }
    };
    child.stdout.on('data', (chunk: Buffer) => {
      let i = 0;
      if (odd !== undefined && chunk.length > 0) {
        sample(((odd | (chunk[0]! << 8)) << 16) >> 16);
        odd = undefined;
        i = 1;
      }
      for (; i + 1 < chunk.length; i += 2) sample(((chunk[i]! | (chunk[i + 1]! << 8)) << 16) >> 16);
      if (i < chunk.length) odd = chunk[i];
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (stderr = (stderr + chunk).slice(-2000)));
    child.on('error', (error: NodeJS.ErrnoException) =>
      reject(error.code === 'ENOENT' ? new CoreError('ffmpeg-missing', `ffmpeg was not found (looked for "${ffmpegPath()}")`) : error),
    );
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(new CoreError('cancelled', 'cancelled'));
      if (code !== 0) return reject(new CoreError('invalid-media', `reading the mic track ${path} failed:\n${stderr.trim()}`));
      if (count > 0) levels.push(toDb(sum / count));
      resolve(Float32Array.from(levels));
    });
  });
}

const toDb = (meanSquare: number) => (meanSquare > 0 ? Math.max(FLOOR_DB, 10 * Math.log10(meanSquare / 32768 ** 2)) : FLOOR_DB);

export const SPEECH_RULES = {
  /** A quieter gap shorter than this does not split a stretch (between words, stops like "t"). */
  minSilence: 0.25,
  /** A louder run shorter than this is not a stretch (a click). */
  minSound: 0.06,
  /** The loud level is the take's 98th percentile, the floor its 10th; the threshold lies halfway, in dB. */
  share: 0.5,
  /** Less than this between the floor and the loud level: nobody spoke (a muted mic, steady noise). */
  minRange: 12,
};

/** The value at share `p` of sorted levels. */
export function percentile(sorted: Float32Array, p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))]!;
}

/**
 * The stretches that are clearly louder than the track's quiet floor: the threshold lies halfway
 * (in dB) between its 10th and 98th percentile, gaps shorter than `minSilence` are bridged, and
 * runs shorter than `minSound` dropped. None when the track hardly varies (a muted mic).
 */
export function speechStretches(levels: Float32Array, rules = SPEECH_RULES): Span[] {
  if (levels.length === 0) return [];
  const sorted = Float32Array.from(levels).sort();
  const floor = percentile(sorted, 0.1);
  const loud = percentile(sorted, 0.98);
  if (loud - floor < rules.minRange) return [];
  const threshold = floor + rules.share * (loud - floor);
  const runs: Span[] = [];
  let start: number | undefined;
  for (let i = 0; i <= levels.length; i++) {
    const on = i < levels.length && levels[i]! >= threshold;
    if (on && start === undefined) start = i;
    else if (!on && start !== undefined) {
      runs.push({ from: start * LEVEL_SECONDS, to: i * LEVEL_SECONDS });
      start = undefined;
    }
  }
  const merged: Span[] = [];
  for (const run of runs) {
    const last = merged.at(-1);
    if (last && run.from - last.to < rules.minSilence) last.to = run.to;
    else merged.push({ ...run });
  }
  return merged.filter((span) => span.to - span.from >= rules.minSound).map((span) => ({ from: round(span.from), to: round(span.to) }));
}

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;
