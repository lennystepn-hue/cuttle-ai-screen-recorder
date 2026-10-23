// `cuttle captions set`: the subtitles' languages. `--translation <language>` takes a translation
// (`subtitles/<language>.json`, from `transcript --translate`) into the project, once every sentence
// has its text; `--show <language>` puts a language in the picture (`spoken`: the words as said).
import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { readProjectFile, writeProjectFile } from '@cuttle/core';
import { LANGUAGE_CODE, parseTranslationJson, translationPath } from '@cuttle/project';
import { CliError } from '../errors';
import type { Output } from '../output';

export interface CaptionsSetArgs {
  translation?: string;
  /** The translation's file (default `subtitles/<language>.json`). */
  file?: string;
  /** A language for the picture, or `spoken`. */
  show?: string;
}

export async function captionsSetCommand(projectDir: string, args: CaptionsSetArgs, output: Output): Promise<{ captions: Record<string, unknown> }> {
  if (args.translation === undefined && args.show === undefined) throw new CliError('usage', 'say what: --translation <language> (with --file), --show <language> or --show spoken');
  if (args.file !== undefined && args.translation === undefined) throw new CliError('usage', '--file is the file of a --translation');
  const file = await readProjectFile(projectDir);
  const captions = { ...((file.raw.captions as Record<string, unknown> | undefined) ?? {}) };
  const translations = { ...((captions.translations as Record<string, string> | undefined) ?? {}) };
  if (args.translation !== undefined) {
    const language = args.translation;
    if (!LANGUAGE_CODE.test(language)) throw new CliError('usage', `"${language}" is not a language code: de, en, pt-BR`);
    const path = resolve(file.dir, args.file ?? translationPath(language));
    const inside = relative(file.dir, path);
    if (inside.startsWith('..') || resolve(file.dir, inside) !== path) throw new CliError('usage', `${args.file} is not in the project folder`);
    const text = await readFile(path, 'utf8').catch(() => {
      throw new CliError('missing-file', `no translation at ${inside}: "cuttle transcript --translate ${language}" writes it`);
    });
    const parsed = parseTranslationJson(text);
    if (!parsed.ok) throw new CliError('invalid-project', `${inside} is not a translation:\n${parsed.issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n')}`);
    if (parsed.translation.language !== language) throw new CliError('usage', `${inside} is in "${parsed.translation.language}", not "${language}"`);
    const missing = parsed.translation.sentences.filter((sentence) => sentence.text.trim() === '');
    if (missing.length > 0) {
      throw new CliError('invalid-project', `${inside}: ${missing.length} of ${parsed.translation.sentences.length} sentences have no translation yet (the first at ${missing[0]!.at} s: "${missing[0]!.source}")`);
    }
    translations[language] = inside.split(sep).join('/');
    captions.translations = translations;
  }
  if (args.show !== undefined) {
    if (args.show === 'spoken') delete captions.language;
    else if (!translations[args.show]) throw new CliError('usage', `there are no "${args.show}" subtitles: --translation ${args.show} first (${Object.keys(translations).join(', ') || 'none yet'})`);
    else captions.language = args.show;
  }
  file.raw.captions = captions;
  await writeProjectFile(file, 'captions set');
  output.result({ captions }, () => `subtitles: ${['spoken', ...Object.keys(translations)].join(', ')}; the picture shows ${(captions.language as string | undefined) ?? 'the words as spoken'}`);
  return { captions };
}
