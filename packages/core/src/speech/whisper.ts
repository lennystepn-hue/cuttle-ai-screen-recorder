// One run of ffmpeg's `whisper` filter over a track: its option values escaped for the filter
// graph, its JSON lines read by pattern (the filter does not escape the text), progress from
// `-progress`.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoreError } from '../errors';
import { ffmpegPath, runFfmpeg } from '../ffmpeg';

/** A word as whisper wrote it, in seconds of the track it heard. */
export interface HeardWord {
  t: number;
  end: number;
  text: string;
}

/**
 * A value for a filter option inside `-af`, escaped for both levels ffmpeg parses: the option list
 * (`\`, `'` and `:` are special) and the filter graph around it (`\`, `'`, `[`, `]`, `,`, `;`).
 * Backslashes in Windows paths become slashes first, which ffmpeg takes on every platform.
 */
export function filterValue(value: string, path = true): string {
  const plain = path ? value.replaceAll('\\', '/') : value;
  const option = plain.replace(/[\\':]/g, '\\$&');
  return option.replace(/[\\'[\],;]/g, '\\$&');
}

/** Letters and digits only, lower case: how words are compared. */
export const normWord = (text: string) => text.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * The words of the filter's `format=json` output, one per line: `{"start":ms,"end":ms,"text":"…"}`.
 * The text is not escaped (a quotation mark in the speech is written as is), so each line is read
 * with a pattern. Lines without a letter or digit and whisper's notes in brackets (`[BLANK_AUDIO]`,
 * `(Musik)`) are not words.
 */
export function parseWhisperLines(text: string): HeardWord[] {
  const words: HeardWord[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\{"start":(\d+),"end":(\d+),"text":"(.*)"\}\s*$/.exec(line);
    if (!match) continue;
    const word = match[3]!.trim();
    if (!normWord(word) || /^[[(*].*[\])*]$/.test(word)) continue;
    const t = Number(match[1]) / 1000;
    words.push({ t, end: Math.max(t, Number(match[2]) / 1000), text: word });
  }
  return words;
}

let whisperChecked: Promise<boolean> | undefined;

/**
 * Whether the ffmpeg in use has the `whisper` filter (ffmpeg 8 or later, built with whisper.cpp).
 * The answer is kept; `fresh` asks ffmpeg again (the app, after ffmpeg was updated).
 */
export function hasWhisper(fresh = false): Promise<boolean> {
  if (fresh) whisperChecked = undefined;
  whisperChecked ??= runFfmpeg(['-filters']).then(
    ({ stdout }) => /^\s*\S+\s+whisper\s/m.test(stdout.toString('utf8')),
    (error: unknown) => {
      whisperChecked = undefined;
      throw error;
    },
  );
  return whisperChecked;
}

export interface WhisperOptions {
  model: string;
  /** `auto`, or a language code such as `de` or `en`. */
  language: string;
  /** Seconds of the track, for the progress. */
  seconds: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * Transcribes the first audio stream of `input` in one run: 30 s windows (shorter ones break words
 * at their edges), one word per line, on the GPU where there is one.
 */
export async function runWhisper(input: string, options: WhisperOptions): Promise<HeardWord[]> {
  if (!(await hasWhisper())) {
    throw new CoreError('ffmpeg-old', 'this ffmpeg cannot transcribe: it has no whisper filter (ffmpeg 8 or later). Update it: winget upgrade Gyan.FFmpeg (macOS: brew upgrade ffmpeg)');
  }
  const dir = await mkdtemp(join(tmpdir(), 'cuttle-whisper-'));
  const out = join(dir, 'words.json');
  try {
    const filter = [
      `whisper=model=${filterValue(options.model)}`,
      `language=${filterValue(options.language, false)}`,
      'format=json',
      `destination=${filterValue(out)}`,
      'max_len=1',
      'queue=30',
      'use_gpu=1',
    ].join(':');
    await new Promise<void>((resolve, reject) => {
      if (options.signal?.aborted) return reject(cancelled());
      const child = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', '-i', input, '-map', '0:a:0', '-af', filter, '-f', 'null', '-'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const abort = () => child.kill();
      options.signal?.addEventListener('abort', abort, { once: true });
      let stderr = '';
      let buffered = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffered += chunk;
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() ?? '';
        for (const line of lines) {
          const match = /^out_time_us=(\d+)$/.exec(line.trim());
          if (match && options.seconds > 0) options.onProgress?.(Math.min(1, Number(match[1]) / 1e6 / options.seconds));
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => (stderr = (stderr + chunk).slice(-4000)));
      child.on('error', (error: NodeJS.ErrnoException) =>
        reject(error.code === 'ENOENT' ? new CoreError('ffmpeg-missing', `ffmpeg was not found (looked for "${ffmpegPath()}")`) : error),
      );
      child.on('close', (code) => {
        options.signal?.removeEventListener('abort', abort);
        if (options.signal?.aborted) return reject(cancelled());
        if (code === 0) return resolve();
        reject(new CoreError('invalid-media', `transcribing ${input} failed (exit code ${code}):\n${stderr.trim().split(/\r?\n/).slice(-6).join('\n')}`));
      });
    });
    return parseWhisperLines(await readFile(out, 'utf8').catch(() => ''));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const cancelled = () => new CoreError('cancelled', 'the transcription was cancelled');
