// Transcribes a project's mic track: one whisper run, the words aligned to the mic's speech
// stretches, written as takes/<n>/transcript.json and linked from cuttle.json.
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parseTakeJson, parseTranscriptJson, trackOffset, TRANSCRIPT_VERSION, type TranscriptFile } from '@cuttle/project';
import { CoreError } from '../errors';
import { readProjectFile, writeProjectFile } from '../project-file';
import { streamSeconds } from '../suggest/media';
import { samePath } from '../use-take';
import { alignWords, guessLanguage } from './align';
import { likelyFiller } from './edits';
import { micLevels, speechStretches } from './levels';
import { chooseModel, modelPath, SPEECH_MODELS } from './models';
import { runWhisper } from './whisper';

export const TRANSCRIPT_FILE = 'transcript.json';

export interface TranscribeOptions {
  /** The speech model (default: `small` when downloaded, else the best one there is). */
  model?: string;
  /** `auto` (the default), or a language code such as `de` or `en`. */
  language?: string;
  /** The fraction done, 0 to 1. */
  onProgress?: (fraction: number) => void;
  onStatus?: (text: string) => void;
  signal?: AbortSignal;
  /**
   * Link the transcript from cuttle.json (default true). The app links it together with the speech
   * edits instead (`applySpeechEdits`'s `link`), so the editor gets one change.
   */
  link?: boolean;
}

export interface TranscribeResult {
  project: string;
  /** transcript.json, relative to the project folder. */
  transcript: string;
  model: string;
  language: string;
  words: number;
  /** Stretches the mic heard without a word. */
  sounds: number;
  /** Words whisper heard where the mic was quiet, left out. */
  dropped: number;
  /** Whether the word times were aligned to the mic (else whisper's own). */
  aligned: boolean;
  notes: string[];
}

/**
 * Seconds by which the mic track started after the screen track, from the take.json next to the
 * screen track; 0 when it does not describe this mic file.
 */
export async function micOffset(screen: string, mic: string): Promise<number> {
  const parsed = parseTakeJson(await readFile(join(dirname(screen), 'take.json'), 'utf8').catch(() => ''));
  if (!parsed.ok) return 0;
  const { take } = parsed;
  if (!samePath(resolve(dirname(screen), take.tracks.screen.file), screen)) return 0;
  const entry = take.tracks.mic;
  if (!entry || !samePath(resolve(dirname(screen), entry.file), mic)) return 0;
  return trackOffset(take, 'mic') ?? 0;
}

const projectPath = (dir: string, path: string) => relative(dir, path).split(sep).join('/');

/**
 * Transcribes the project's mic track and links the result (`sources.transcript`). The words are in
 * source seconds (the mic's offset applied); words before the screen track started are left out.
 */
export async function transcribeTake(projectDir: string, options: TranscribeOptions = {}): Promise<TranscribeResult> {
  const file = await readProjectFile(projectDir);
  const { sources } = file.project;
  if (sources.mic === undefined) throw new CoreError('usage', 'the take has no mic track: record with --mic to transcribe what was said');
  const language = options.language ?? 'auto';
  if (!/^(auto|[a-z]{2,3})$/.test(language)) throw new CoreError('usage', `--language takes "auto" or a language code such as "de" or "en", not "${language}"`);
  const model = await chooseModel(options.model);
  if (model === undefined) {
    const small = SPEECH_MODELS.find((entry) => entry.name === 'small')!;
    throw new CoreError('model-missing', `no speech model is downloaded: run "cuttle models download small" (${Math.round(small.bytes / 1e6)} MB, once)`);
  }
  const mic = resolve(file.dir, sources.mic);
  const screen = resolve(file.dir, sources.screen);
  const seconds = await streamSeconds(mic, 'a');
  if (seconds <= 0) throw new CoreError('invalid-media', `${mic} has no audio`);
  options.onStatus?.(`transcribing ${seconds.toFixed(1)} s of the mic with the ${model} model …`);
  options.onProgress?.(0);
  const [levels, heard, offset] = await Promise.all([
    micLevels(mic, options.signal),
    runWhisper(mic, { model: modelPath(model), language, seconds, ...(options.onProgress && { onProgress: options.onProgress }), ...(options.signal && { signal: options.signal }) }),
    micOffset(screen, mic),
  ]);
  const spoken = language === 'auto' ? guessLanguage(heard) : language;
  const alignment = alignWords(heard, speechStretches(levels), { filler: (word) => likelyFiller(word.text, spoken) });
  const shift = (t: number) => Math.round((t + offset) * 1000) / 1000;
  const words = alignment.words.map((word) => ({ t: shift(word.t), end: shift(word.end), text: word.text })).filter((word) => word.t >= 0);
  const sounds = alignment.sounds.map((sound) => ({ t: shift(sound.from), end: shift(sound.to) })).filter((sound) => sound.t >= 0);
  const transcript: TranscriptFile = {
    version: TRANSCRIPT_VERSION,
    language: spoken,
    model,
    words,
    sounds,
  };
  const notes: string[] = [];
  if (!alignment.aligned) notes.push("the word times could not be lined up with the mic's speech: they are whisper's own (about half a second off)");
  if (alignment.dropped.length > 0) notes.push(`left out ${alignment.dropped.length} word(s) heard where the mic was quiet: ${alignment.dropped.map((word) => `"${word.text}"`).slice(0, 5).join(', ')}`);
  if (words.length === 0) notes.push('no words were heard');

  const path = join(dirname(mic), TRANSCRIPT_FILE);
  const part = `${path}.${process.pid}.part`;
  await writeFile(part, `${JSON.stringify(transcript, null, 1)}\n`);
  await rename(part, path);
  const link = projectPath(file.dir, path);
  if (options.link !== false) await linkTranscript(projectDir, link);
  options.onProgress?.(1);
  return {
    project: file.path,
    transcript: link,
    model,
    language: transcript.language,
    words: words.length,
    sounds: sounds.length,
    dropped: alignment.dropped.length,
    aligned: alignment.aligned,
    notes,
  };
}

/**
 * Whether `link` (a transcript, relative to the project) belongs to the project's mic: it lies in
 * the mic's take folder. Transcription takes a while, and the project may have moved to another take.
 */
export function transcriptOfMic(dir: string, sources: { mic?: string | undefined }, link: string): boolean {
  return sources.mic !== undefined && samePath(dirname(resolve(dir, sources.mic)), dirname(resolve(dir, link)));
}

/** Links a transcript from cuttle.json (`sources.transcript`), refusing when the project moved to another take. */
async function linkTranscript(projectDir: string, link: string): Promise<void> {
  const file = await readProjectFile(projectDir);
  if (!transcriptOfMic(file.dir, file.project.sources, link)) {
    throw new CoreError('conflict', `the project moved to another take while it was transcribed: ${link} is not linked`);
  }
  if ((file.raw.sources as Record<string, unknown>).transcript === link) return;
  file.raw.sources = { ...(file.raw.sources as Record<string, unknown>), transcript: link };
  await writeProjectFile(file, 'transcribe');
}

/** The project's transcript; undefined when it has none, or the file is missing or invalid (with a note why). */
export async function readTranscript(projectDir: string, link: string | undefined): Promise<{ transcript?: TranscriptFile; note?: string }> {
  if (link === undefined) return {};
  const text = await readFile(resolve(projectDir, link), 'utf8').catch(() => undefined);
  if (text === undefined) return { note: `${link} cannot be read: no speech edits` };
  const parsed = parseTranscriptJson(text);
  if (!parsed.ok) return { note: `${link} is invalid (${parsed.issues[0]?.path}: ${parsed.issues[0]?.message}): no speech edits` };
  return { transcript: parsed.transcript };
}
