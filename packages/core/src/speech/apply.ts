// The speech edits applied to a project: filler and pause cuts from its transcript, merged with
// the cuts there by the tag rules. `suggest` does this as part of its run; the app does it again
// once the transcript arrives after the cut.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEventsJsonl, usedIds, type CuttleProject, type InputEvent, type TranscriptFile } from '@cuttle/project';
import { CoreError } from '../errors';
import { readProjectFile, writeProjectFile } from '../project-file';
import { analyseScreen } from '../suggest/media';
import { union, type Span } from '../suggest/spans';
import { mergeCuts, speechCuts, type RawCut } from './edits';
import { micLevels, speechStretches } from './levels';
import { micOffset, readTranscript, transcriptOfMic } from './transcribe';

/** Words closer than this are one stretch of speech. */
const WORD_JOIN = 0.3;

/**
 * Where someone speaks, in source seconds: the transcript's words when there is one, else the
 * stretches where the mic is clearly louder than its floor (no model needed); none without a mic.
 */
export async function speechActivity(
  dir: string,
  sources: CuttleProject['sources'],
  transcript: TranscriptFile | undefined,
): Promise<{ spans: Span[]; from: 'transcript' | 'mic' | 'none' }> {
  if (transcript) {
    return { spans: union(transcript.words.map((word) => ({ from: word.t - WORD_JOIN / 2, to: word.end + WORD_JOIN / 2 }))), from: 'transcript' };
  }
  if (sources.mic === undefined) return { spans: [], from: 'none' };
  const mic = resolve(dir, sources.mic);
  try {
    const [levels, offset] = await Promise.all([micLevels(mic), micOffset(resolve(dir, sources.screen), mic)]);
    const spans = speechStretches(levels).map((span) => ({ from: Math.max(0, span.from + offset), to: span.to + offset })).filter((span) => span.to > 0);
    return { spans, from: 'mic' };
  } catch (error) {
    if (error instanceof CoreError && error.code === 'ffmpeg-missing') throw error;
    return { spans: [], from: 'none' };
  }
}

export interface SpeechCutsResult {
  cuts: RawCut[];
  fillers: number;
  pauses: number;
  /** Of those, made switched off (where the person had switched one off). */
  off: number;
  notes: string[];
}

/**
 * The project's cuts with the speech edits of `transcript` (the tagged filler and pause cuts
 * replaced; the others kept). `clips`: the stretches of 1× clips, where cuts are made.
 */
export function withSpeechCuts(
  raw: Record<string, unknown>,
  project: CuttleProject,
  transcript: TranscriptFile,
  input: { still: readonly Span[]; events: readonly InputEvent[]; clips: readonly Span[] },
  taken = usedIds(raw),
): SpeechCutsResult {
  const made = speechCuts(
    {
      words: transcript.words,
      sounds: transcript.sounds.map((sound) => ({ from: sound.t, to: sound.end })),
      language: transcript.language,
      ...input,
    },
    { fillers: project.autoEdits.fillers, pauses: project.autoEdits.pauses },
  );
  const { cuts, added, kept } = mergeCuts((raw.cuts as RawCut[] | undefined) ?? [], made, ['filler', 'pause'], taken);
  const fillers = added.filter((cut) => cut.auto === 'filler').length;
  const pauses = added.filter((cut) => cut.auto === 'pause').length;
  const off = added.filter((cut) => cut.enabled === false).length;
  const notes: string[] = [];
  if (fillers + pauses > 0) {
    const removed = added.filter((cut) => cut.enabled !== false).reduce((sum, cut) => sum + cut.to - cut.from, 0);
    notes.push(`cut ${fillers} filler word${fillers === 1 ? '' : 's'} and ${pauses} pause${pauses === 1 ? '' : 's'} where the picture rests (${removed.toFixed(1)} s)${off > 0 ? `; ${off} stay off, as before` : ''}`);
  }
  if (!project.autoEdits.fillers) notes.push('filler cuts are switched off (autoEdits.fillers)');
  if (!project.autoEdits.pauses) notes.push('pause cuts are switched off (autoEdits.pauses)');
  if (kept > 0) notes.push(`kept ${kept} cut${kept === 1 ? '' : 's'} made by hand or by other steps`);
  return { cuts, fillers, pauses, off, notes };
}

export interface SpeechEditsResult extends SpeechCutsResult {
  project: string;
  written: boolean;
}

/**
 * Applies the speech edits of the project's transcript to cuttle.json, leaving its scenes and every
 * other item as they are: the app's step once the transcript arrives after the cut. `link`: a
 * transcript to link first (in the same write), which must belong to the project's mic.
 */
export async function applySpeechEdits(projectDir: string, options: { link?: string; onStatus?: (text: string) => void } = {}): Promise<SpeechEditsResult> {
  const file = await readProjectFile(projectDir);
  const { sources } = file.project;
  if (options.link !== undefined) {
    if (!transcriptOfMic(file.dir, sources, options.link)) throw new CoreError('conflict', `the project moved to another take while it was transcribed: ${options.link} is not linked`);
    file.raw.sources = { ...(file.raw.sources as Record<string, unknown>), transcript: options.link };
  }
  const linked = options.link ?? sources.transcript;
  const { transcript, note } = await readTranscript(file.dir, linked);
  if (!transcript) throw new CoreError('usage', note ?? 'the project has no transcript: run "cuttle transcribe" first');
  options.onStatus?.('reading the screen recording …');
  const screen = await analyseScreen(resolve(file.dir, sources.screen));
  let events: InputEvent[] = [];
  if (sources.events) {
    const text = await readFile(resolve(file.dir, sources.events), 'utf8').catch(() => undefined);
    if (text !== undefined) events = parseEventsJsonl(text).events;
  }
  const clips = file.project.scenes.flatMap((scene) => (scene.type === 'clip' && scene.speed === 1 ? [{ from: scene.from, to: scene.to }] : []));
  const result = withSpeechCuts(file.raw, file.project, transcript, { still: screen.still, events, clips });
  const before = JSON.stringify(file.raw.cuts ?? []);
  const linking = options.link !== undefined && options.link !== sources.transcript;
  if (JSON.stringify(result.cuts) === before && !linking) return { ...result, project: file.path, written: false };
  if (result.cuts.length > 0 || file.raw.cuts !== undefined) file.raw.cuts = result.cuts;
  await writeProjectFile(file, 'the speech edits');
  return { ...result, project: file.path, written: true };
}
