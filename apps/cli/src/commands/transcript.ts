import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CoreError, readProjectFile, readTranscript } from '@cuttle/core';
import { LANGUAGE_CODE, TRANSLATION_VERSION, parseTranslationJson, translationPath } from '@cuttle/project';
import { applyCaptionFixes, captionCues, captionWords, sceneSpans, sentencesOf, toSrt, toVtt } from '@cuttle/timeline';
import type { Output } from '../output';

export interface TranscriptArgs {
  srt?: boolean;
  vtt?: boolean;
  text?: boolean;
}

export interface TranscriptView {
  transcript: string;
  language: string;
  model: string;
  /** Every word the mic said (the fixes applied), in source seconds. */
  words: { t: number; end: number; text: string }[];
  /** The captions as the video shows them: output seconds, the words of cut and sped-up stretches left out. */
  cues: { start: number; end: number; text: string }[];
}

/**
 * `cuttle transcript`: what the mic said, with the person's fixes: as JSON (the words in source
 * seconds and the captions in output seconds), or as SubRip, WebVTT or plain text.
 */
export async function transcriptCommand(projectDir: string, args: TranscriptArgs, output: Output): Promise<TranscriptView | { format: string; content: string }> {
  const formats = [args.srt && 'srt', args.vtt && 'vtt', args.text && 'text'].filter(Boolean);
  if (formats.length > 1) throw new CoreError('usage', 'choose one of --srt, --vtt and --text');
  const file = await readProjectFile(projectDir);
  const { sources, captions, scenes, cuts } = file.project;
  if (sources.transcript === undefined) throw new CoreError('usage', 'the project has no transcript: run "cuttle transcribe" first');
  const { transcript, note } = await readTranscript(file.dir, sources.transcript);
  if (!transcript) throw new CoreError('invalid-project', note ?? `${sources.transcript} cannot be read`);
  const words = applyCaptionFixes(transcript.words, captions.fixes);
  const cues = captionCues(captionWords(words, sceneSpans(scenes, cuts)), 'subtitle');
  const text = words.map((word) => word.text).join(' ');
  const format = formats[0];
  if (format) {
    const content = format === 'srt' ? toSrt(cues) : format === 'vtt' ? toVtt(cues) : `${text}\n`;
    const result = { format, content };
    output.result(result, () => content.replace(/\n$/, ''));
    return result;
  }
  const view: TranscriptView = {
    transcript: sources.transcript,
    language: transcript.language,
    model: transcript.model,
    words,
    cues: cues.map((cue) => ({ start: cue.start, end: cue.end, text: cue.lines.map((line) => line.map((word) => word.text).join(' ')).join('\n') })),
  };
  output.result(view, () => `${text}\n(${words.length} words, ${transcript.language}, ${cues.length} captions in the video)`);
  return view;
}

/** What `transcript --translate` wrote: the file to fill and how much of it is still to translate. */
export interface TranslationStart {
  file: string;
  language: string;
  sentences: number;
  /** Sentences still without a translation. */
  missing: number;
  /** What the person (or Claude) does next. */
  next: string;
}

/**
 * `cuttle transcript --translate <language>`: the transcript's sentences (the fixes applied), each
 * on its original timing, written to `subtitles/<language>.json` with an empty `text` to translate
 * into; a sentence already translated there keeps its translation. `captions set --translation`
 * takes the file back.
 */
export async function translateCommand(projectDir: string, language: string, output: Output): Promise<TranslationStart> {
  if (!LANGUAGE_CODE.test(language)) throw new CoreError('usage', `"${language}" is not a language code: de, en, pt-BR`);
  const file = await readProjectFile(projectDir);
  const { sources, captions } = file.project;
  if (sources.transcript === undefined) throw new CoreError('usage', 'the project has no transcript: run "cuttle transcribe" first');
  const { transcript, note } = await readTranscript(file.dir, sources.transcript);
  if (!transcript) throw new CoreError('invalid-project', note ?? `${sources.transcript} cannot be read`);
  const relative = captions.translations?.[language] ?? translationPath(language);
  const path = join(file.dir, relative);
  // what was translated before stays, where the sentence did not change
  const before = await readFile(path, 'utf8').then(parseTranslationJson, () => undefined);
  const kept = before?.ok ? before.translation.sentences : [];
  const sentences = sentencesOf(applyCaptionFixes(transcript.words, captions.fixes)).map((sentence) => {
    const same = kept.find((old) => Math.abs(old.at - sentence.at) < 0.01 && old.source === sentence.text);
    return { at: round(sentence.at), end: round(sentence.end), source: sentence.text, text: same?.text ?? '' };
  });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ version: TRANSLATION_VERSION, language, sentences }, null, 2)}\n`);
  const missing = sentences.filter((sentence) => sentence.text.trim() === '').length;
  const result: TranslationStart = {
    file: relative,
    language,
    sentences: sentences.length,
    missing,
    next: `write each sentence's "text" in ${language} (as it would be said, about as long as the original), then: cuttle captions set --translation ${language}`,
  };
  output.result(result, () => `${relative}: ${sentences.length} sentences, ${missing} to translate\nnext: ${result.next}`);
  return result;
}

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;
