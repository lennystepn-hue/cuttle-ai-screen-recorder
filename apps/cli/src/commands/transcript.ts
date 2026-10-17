import { CoreError, readProjectFile, readTranscript } from '@cuttle/core';
import { applyCaptionFixes, captionCues, captionWords, sceneSpans, toSrt, toVtt } from '@cuttle/timeline';
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
