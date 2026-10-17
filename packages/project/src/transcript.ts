import { z } from 'zod';
import { formatPath, type ProjectIssue } from './parse';

/** The transcript.json format version this build reads and writes. */
export const TRANSCRIPT_VERSION = 1;

const seconds = z.number().nonnegative();

/** One spoken word; `t` and `end` are source seconds of the screen track, like events.jsonl. */
export const TranscriptWordSchema = z
  .strictObject({ t: seconds, end: seconds, text: z.string().min(1) })
  .refine((word) => word.end >= word.t, { message: '"end" must not be before "t"', path: ['end'] });

/**
 * transcript.json, written next to the take's tracks once the mic was transcribed (`cuttle
 * transcribe`, the app after a take). `sounds`: stretches the mic heard where no word was written
 * (a filler the speech model left out, a cough, a click), in source seconds.
 */
export const TranscriptFileSchema = z.strictObject({
  version: z.literal(TRANSCRIPT_VERSION),
  /** What was spoken, as told or guessed from the words (`de`, `en`, … or `auto` when unclear). */
  language: z.string().min(1),
  /** The speech model that wrote it (`small`, …). */
  model: z.string().min(1),
  words: z.array(TranscriptWordSchema),
  sounds: z.array(z.strictObject({ t: seconds, end: seconds })).default([]),
});

export type TranscriptWord = z.output<typeof TranscriptWordSchema>;
export type TranscriptFile = z.output<typeof TranscriptFileSchema>;
export type TranscriptParseResult = { ok: true; transcript: TranscriptFile } | { ok: false; issues: ProjectIssue[] };

export function parseTranscriptJson(text: string): TranscriptParseResult {
  let raw: unknown;
  try {
    // A UTF-8 byte order mark (U+FEFF), as Windows editors and PowerShell 5.1 write one, is not JSON.
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (error) {
    return { ok: false, issues: [{ path: '(root)', message: `Invalid JSON: ${(error as Error).message}` }] };
  }
  const result = TranscriptFileSchema.safeParse(raw);
  if (result.success) return { ok: true, transcript: result.data };
  return { ok: false, issues: result.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })) };
}
