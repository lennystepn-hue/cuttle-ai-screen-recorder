import { z } from 'zod';
import { formatPath, type ProjectIssue } from './parse';

/** The format version of a translation file this build reads and writes. */
export const TRANSLATION_VERSION = 1;

/** A language's code: `de`, `en`, `pt-BR`, `zh-Hans`. */
export const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** Where a language's translation of the subtitles lives in a project, by default. */
export const translationPath = (language: string) => `subtitles/${language}.json`;

const seconds = z.number().nonnegative();

/**
 * A sentence of the transcript, translated: it shows where the original was spoken (`at` to `end`,
 * source seconds); `source` is what was said, `text` the translation ("" until it is written).
 */
export const TranslatedSentenceSchema = z
  .strictObject({ at: seconds, end: seconds, source: z.string(), text: z.string() })
  .refine((sentence) => sentence.end >= sentence.at, { message: '"end" must not be before "at"', path: ['end'] });

/**
 * The subtitles in another language (`subtitles/<language>.json`): the transcript's sentences on
 * their original timing, each with its translation. `cuttle transcript --translate <language>` writes
 * it with the translations empty; `cuttle captions set --translation <language>` takes it in.
 */
export const TranslationFileSchema = z.strictObject({
  version: z.literal(TRANSLATION_VERSION),
  language: z.string().regex(LANGUAGE_CODE, 'a language code: de, en, pt-BR'),
  sentences: z.array(TranslatedSentenceSchema),
});

export type TranslatedSentence = z.output<typeof TranslatedSentenceSchema>;
export type TranslationFile = z.output<typeof TranslationFileSchema>;
export type TranslationParseResult = { ok: true; translation: TranslationFile } | { ok: false; issues: ProjectIssue[] };

export function parseTranslationJson(text: string): TranslationParseResult {
  let raw: unknown;
  try {
    // a UTF-8 byte order mark, as Windows editors write one, is not JSON
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (error) {
    return { ok: false, issues: [{ path: '(root)', message: `Invalid JSON: ${(error as Error).message}` }] };
  }
  const result = TranslationFileSchema.safeParse(raw);
  if (result.success) return { ok: true, translation: result.data };
  return { ok: false, issues: result.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })) };
}
