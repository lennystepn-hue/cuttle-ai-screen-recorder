// One run of whisper over a track. With ffmpeg's `whisper` filter (ffmpeg 8 or later built with
// whisper.cpp, as Gyan's Windows builds are): its option values escaped for the filter graph, its
// JSON lines read by pattern (the filter does not escape the text), progress from `-progress`. No
// macOS ffmpeg has that filter (Homebrew's neither), so whisper.cpp's own whisper-cli runs instead
// where it is installed (brew install whisper-cpp), with the filter's settings and the same model.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { normWord } from '@cuttle/project';
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

/**
 * The words of whisper-cli's JSON (`-oj`): its segments, one word each with `-ml 1 -sow`, read as
 * the filter's lines are.
 */
export function parseWhisperCliJson(text: string): HeardWord[] {
  let segments: { offsets?: { from?: number; to?: number }; text?: string }[];
  try {
    segments = (JSON.parse(text) as { transcription?: typeof segments }).transcription ?? [];
  } catch {
    return [];
  }
  const line = ({ offsets, text: said }: (typeof segments)[number]) =>
    `{"start":${Math.round(offsets?.from ?? 0)},"end":${Math.round(offsets?.to ?? 0)},"text":"${(said ?? '').replace(/[\r\n]+/g, ' ')}"}`;
  return parseWhisperLines(segments.map(line).join('\n'));
}

/**
 * whisper.cpp's command: CUTTLE_WHISPER_CLI, else whisper-cli on PATH; on macOS also in Homebrew's
 * folders and ~/.local/bin, which an app started from the Dock does not have on its PATH.
 */
export function whisperCliPath(): string | undefined {
  const chosen = process.env.CUTTLE_WHISPER_CLI;
  if (chosen) return existsSync(chosen) ? chosen : undefined;
  const name = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  const mac = process.platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local', 'bin')] : [];
  return [...(process.env.PATH ?? '').split(delimiter), ...mac].filter((dir) => dir !== '').map((dir) => join(dir, name)).find((file) => existsSync(file));
}

/** How whisper runs here: ffmpeg's filter, else whisper-cli (`path`). */
export type WhisperEngine = { kind: 'filter' } | { kind: 'cli'; path: string };

let engineChecked: Promise<WhisperEngine | undefined> | undefined;

/**
 * Whisper as this machine has it: ffmpeg's `whisper` filter, else whisper-cli, else undefined. The
 * answer is kept; `fresh` asks again (the app, after ffmpeg or whisper.cpp was installed).
 */
export function whisperEngine(fresh = false): Promise<WhisperEngine | undefined> {
  if (fresh) engineChecked = undefined;
  engineChecked ??= runFfmpeg(['-filters']).then(
    ({ stdout }): WhisperEngine | undefined => {
      if (/^\s*\S+\s+whisper\s/m.test(stdout.toString('utf8'))) return { kind: 'filter' };
      const cli = whisperCliPath();
      return cli ? { kind: 'cli', path: cli } : undefined;
    },
    (error: unknown) => {
      engineChecked = undefined;
      throw error;
    },
  );
  return engineChecked;
}

/** Whether this machine can transcribe (see whisperEngine). */
export async function hasWhisper(fresh = false): Promise<boolean> {
  return (await whisperEngine(fresh)) !== undefined;
}

/** What to install when there is no whisper, said for people. */
export const NO_WHISPER = 'ffmpeg has no whisper filter and whisper-cli was not found (Windows: winget upgrade Gyan.FFmpeg; macOS: brew install whisper-cpp)';

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
  const engine = await whisperEngine();
  if (!engine) throw new CoreError('ffmpeg-old', `this machine cannot transcribe: ${NO_WHISPER}`);
  const dir = await mkdtemp(join(tmpdir(), 'cuttle-whisper-'));
  try {
    return engine.kind === 'cli' ? await runCli(engine.path, input, options, dir) : await runFilter(input, options, dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** The filter's run, its words written into `dir`. */
async function runFilter(input: string, options: WhisperOptions, dir: string): Promise<HeardWord[]> {
  const out = join(dir, 'words.json');
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
}

/**
 * whisper-cli's run: the track as the 16 kHz mono WAV it reads, then the filter's settings (greedy,
 * one word per segment split on words, the GPU where there is one), its progress from `-pp`.
 */
async function runCli(cli: string, input: string, options: WhisperOptions, dir: string): Promise<HeardWord[]> {
  const wav = join(dir, 'audio.wav');
  await runFfmpeg(['-i', input, '-map', '0:a:0', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', '-y', wav]);
  if (options.signal?.aborted) throw cancelled();
  const out = join(dir, 'words');
  const args = ['-m', options.model, '-f', wav, '-l', options.language, '-bs', '1', '-ml', '1', '-sow', '-oj', '-of', out, '-np', '-pp'];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cli, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    const abort = () => child.kill();
    options.signal?.addEventListener('abort', abort, { once: true });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
      for (const match of chunk.matchAll(/progress\s*=\s*(\d+)%/g)) options.onProgress?.(Math.min(1, Number(match[1]) / 100));
    });
    child.on('error', (error: NodeJS.ErrnoException) => reject(error.code === 'ENOENT' ? new CoreError('ffmpeg-old', `whisper-cli was not found (looked for "${cli}")`) : error));
    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', abort);
      if (options.signal?.aborted) return reject(cancelled());
      if (code === 0) return resolve();
      reject(new CoreError('invalid-media', `transcribing ${input} failed (whisper-cli exit code ${code}):\n${stderr.trim().split(/\r?\n/).slice(-6).join('\n')}`));
    });
  });
  return parseWhisperCliJson(await readFile(`${out}.json`, 'utf8').catch(() => ''));
}

const cancelled = () => new CoreError('cancelled', 'the transcription was cancelled');
