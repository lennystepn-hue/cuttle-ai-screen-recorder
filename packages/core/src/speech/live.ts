// Live captions: the mic's samples transcribed while a take records, each word about two seconds
// after it is said. With ffmpeg's whisper filter one ffmpeg reads the samples on its stdin and writes
// each word to its stdout as soon as it has transcribed a short window. whisper-cli (macOS) reads
// files only: the samples go to it in windows of a few seconds, each cut where the sound is quietest,
// one run at a time.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normWord } from '@cuttle/project';
import { CoreError } from '../errors';
import { ffmpegPath } from '../ffmpeg';
import { installedModels, type ModelName } from './models';
import { filterValue, NO_WHISPER, parseWhisperLines, runWhisper, whisperEngine, type HeardWord } from './whisper';

/** The samples' rate: 16 kHz mono 16-bit little-endian, as the mic's capture gives them. */
export const LIVE_RATE = 16_000;

export const LIVE_RULES = {
  /** The filter's window, in seconds of sound: shorter is sooner, longer understands more. */
  window: 2,
  /** whisper-cli's windows: cut between these seconds, in the quietest tenth of a second. */
  least: 3,
  most: 5,
  /** Seconds of sound that may wait for whisper: more is dropped, so the captions stay current. */
  behind: 4,
  /** A word heard again within this many seconds of itself is one word at a window's edge. */
  echo: 0.3,
} as const;

/** How the captions run: one ffmpeg that reads the samples as they come, or a whisper run per window. */
export type LiveMode = 'stream' | 'windows';

export interface LiveOptions {
  /** The model's file. */
  model: string;
  /** `auto`, or a language code such as `de` or `en`. */
  language: string;
  /** Default: `stream` with ffmpeg's whisper filter, `windows` with whisper-cli. */
  mode?: LiveMode;
  /** New words as they are heard, in seconds of the sound whisper was given. */
  onWords: (words: HeardWord[]) => void;
  /** Whisper failed, or this machine has none: the captions end (once), and the take goes on. */
  onError?: (error: Error) => void;
}

export interface LiveCaptions {
  /** Whole 16 kHz mono 16-bit samples, as the mic gives them. */
  push(samples: Uint8Array): void;
  /** Ends the captions; words still being transcribed are not waited for. */
  stop(): void;
}

interface Feed {
  push(samples: Uint8Array): void;
  stop(): void;
}

type Heard = (words: HeardWord[]) => void;
type Fail = (error: Error) => void;

const BYTES_PER_SECOND = LIVE_RATE * 2;

/** The model for live captions: the fastest one downloaded, since they must keep up with speech. */
export async function liveModel(): Promise<ModelName | undefined> {
  return (await installedModels())[0];
}

/**
 * Transcribes the samples pushed while it runs. Whisper is looked for first; samples pushed until
 * then wait (at most `LIVE_RULES.behind` seconds of them).
 */
export function liveCaptions(options: LiveOptions): LiveCaptions {
  let feed: Feed | undefined;
  let stopped = false;
  let failed = false;
  const waiting: Uint8Array[] = [];
  let last: HeardWord | undefined;
  const heard: Heard = (words) => {
    if (stopped || failed) return;
    const fresh = withoutEchoes(words, last);
    last = words.at(-1) ?? last;
    if (fresh.length > 0) options.onWords(fresh);
  };
  const fail: Fail = (error) => {
    if (stopped || failed) return;
    failed = true;
    feed?.stop();
    options.onError?.(error);
  };
  whisperEngine().then((engine) => {
    if (stopped || failed) return;
    if (!engine) return fail(new CoreError('ffmpeg-old', `there are no live captions: ${NO_WHISPER}`));
    const mode = options.mode ?? (engine.kind === 'filter' ? 'stream' : 'windows');
    feed = mode === 'stream' ? streamFeed(options, heard, fail) : windowFeed(options, heard, fail);
    for (const samples of waiting.splice(0)) feed.push(samples);
  }, fail);
  return {
    push(samples) {
      if (stopped || failed) return;
      if (feed) return feed.push(samples);
      waiting.push(samples);
      let bytes = waiting.reduce((sum, chunk) => sum + chunk.length, 0);
      while (bytes > LIVE_RULES.behind * BYTES_PER_SECOND) bytes -= waiting.shift()!.length;
    },
    stop() {
      stopped = true;
      feed?.stop();
    },
  };
}

/**
 * The words that are new: a word at a window's edge can be heard in both windows, the second time
 * starting within `LIVE_RULES.echo` seconds of the first's end.
 */
export function withoutEchoes(words: readonly HeardWord[], last: HeardWord | undefined): HeardWord[] {
  const fresh: HeardWord[] = [];
  let previous = last;
  for (const word of words) {
    const echo = previous !== undefined && normWord(word.text) === normWord(previous.text) && word.t - previous.end < LIVE_RULES.echo;
    if (!echo) fresh.push(word);
    previous = word;
  }
  return fresh;
}

/** ffmpeg's whisper filter on the samples as they come, its words on its stdout. */
function streamFeed(options: LiveOptions, heard: Heard, fail: Fail): Feed {
  const filter = [
    `whisper=model=${filterValue(options.model)}`,
    `language=${filterValue(options.language, false)}`,
    'format=json',
    `destination=${filterValue('pipe:1', false)}`,
    'max_len=1',
    `queue=${LIVE_RULES.window}`,
    'use_gpu=1',
  ].join(':');
  const args = ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', String(LIVE_RATE), '-ac', '1', '-i', 'pipe:0', '-af', filter, '-f', 'null', '-'];
  const child = spawn(ffmpegPath(), args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stopping = false;
  let lines = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    lines += chunk;
    const end = lines.lastIndexOf('\n');
    if (end < 0) return;
    heard(parseWhisperLines(lines.slice(0, end)));
    lines = lines.slice(end + 1);
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => (stderr = (stderr + chunk).slice(-2000)));
  child.stdin.on('error', () => {}); // ffmpeg ended: its exit says why
  child.on('error', (error: NodeJS.ErrnoException) =>
    fail(error.code === 'ENOENT' ? new CoreError('ffmpeg-missing', `ffmpeg was not found (looked for "${ffmpegPath()}")`) : error),
  );
  child.on('close', (code) => {
    if (stopping) return;
    const why = stderr.trim().split(/\r?\n/).slice(-3).join(' ');
    fail(new CoreError('invalid-media', `the live captions stopped (ffmpeg exit code ${code})${why ? `: ${why}` : ''}`));
  });
  return {
    push(samples) {
      // whisper is behind: the sound is dropped rather than heard later and later
      if (stopping || child.stdin.writableLength > LIVE_RULES.behind * BYTES_PER_SECOND) return;
      child.stdin.write(samples);
    },
    stop() {
      stopping = true;
      child.stdin.end();
      child.kill();
    },
  };
}

/**
 * A whisper run per window of a few seconds (whisper-cli reads files only): one at a time, and when
 * whisper is behind, a window waiting is dropped for the newer one.
 */
function windowFeed(options: LiveOptions, heard: Heard, fail: Fail): Feed {
  const dir = mkdtempSync(join(tmpdir(), 'cuttle-live-'));
  const abort = new AbortController();
  let pending: Uint8Array = new Uint8Array(0);
  /** Seconds of sound before `pending`. */
  let start = 0;
  let waiting: { samples: Uint8Array; start: number } | undefined;
  let running = false;
  let count = 0;
  const run = () => {
    if (running || !waiting || abort.signal.aborted) return;
    const window = waiting;
    waiting = undefined;
    running = true;
    const file = join(dir, `window-${++count}.wav`);
    const seconds = window.samples.length / BYTES_PER_SECOND;
    writeFile(file, wav(window.samples))
      .then(() => runWhisper(file, { model: options.model, language: options.language, seconds, signal: abort.signal }))
      .then((words) => heard(words.map((word) => ({ ...word, t: word.t + window.start, end: word.end + window.start }))))
      .catch((error: unknown) => !abort.signal.aborted && fail(error instanceof Error ? error : new Error(String(error))))
      .finally(() => {
        running = false;
        void rm(file, { force: true }).catch(() => {});
        run();
      });
  };
  return {
    push(samples) {
      if (abort.signal.aborted) return;
      const joined = new Uint8Array(pending.length + samples.length);
      joined.set(pending);
      joined.set(samples, pending.length);
      pending = joined;
      if (pending.length < LIVE_RULES.most * BYTES_PER_SECOND) return;
      const cut = quietestCut(pending);
      waiting = { samples: pending.slice(0, cut), start };
      start += cut / BYTES_PER_SECOND;
      pending = pending.slice(cut);
      run();
    },
    stop() {
      abort.abort();
      void rm(dir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/**
 * Where to cut the samples into a window (a byte offset): in the middle of the quietest tenth of a
 * second between `LIVE_RULES.least` and `LIVE_RULES.most` seconds (the later one of equals), so a
 * word is rarely cut in two.
 */
export function quietestCut(samples: Uint8Array): number {
  const view = new DataView(samples.buffer, samples.byteOffset, samples.byteLength);
  const slot = BYTES_PER_SECOND / 10;
  const end = Math.min(samples.length, LIVE_RULES.most * BYTES_PER_SECOND);
  let best = Math.min(end, LIVE_RULES.least * BYTES_PER_SECOND);
  let quietest = Infinity;
  for (let from = LIVE_RULES.least * BYTES_PER_SECOND; from + slot <= end; from += slot) {
    let sum = 0;
    for (let i = from; i < from + slot; i += 2) sum += view.getInt16(i, true) ** 2;
    if (sum <= quietest) {
      quietest = sum;
      best = from + slot / 2;
    }
  }
  return best;
}

/** The samples as a WAV file (16 kHz mono 16-bit). */
function wav(samples: Uint8Array): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + samples.length, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(LIVE_RATE, 24);
  header.writeUInt32LE(BYTES_PER_SECOND, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}
