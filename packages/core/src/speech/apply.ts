// The speech edits applied to a project: retakes (the mistake key, a spoken "nochmal"), and filler
// and pause cuts from its transcript, merged with the cuts there by the tag rules. `suggest` does
// this as part of its run; the app does it again once the transcript arrives after the cut.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEventsJsonl, parseMarkersJson, usedIds, type CuttleProject, type InputEvent, type Marker, type TranscriptFile } from '@cuttle/project';
import { CoreError } from '../errors';
import { readProjectFile, writeProjectFile } from '../project-file';
import { analyseScreen } from '../suggest/media';
import { union, type Span } from '../suggest/spans';
import { mergeCuts, speechCuts, type RawCut } from './edits';
import { micLevels, speechStretches } from './levels';
import { retakeCuts, type RetakeCut } from './retakes';
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
  retakes: number;
  /** Of those, made switched off (where the person had switched one off). */
  off: number;
  notes: string[];
}

export interface SpeechCutsInput {
  /** The take's transcript: without one, only the retakes of the mistake key are made. */
  transcript?: TranscriptFile;
  markers: readonly Marker[];
  /** Where someone speaks (the words, or the mic's loud stretches), for the pause before a slip. */
  speech: readonly Span[];
  still: readonly Span[];
  events: readonly InputEvent[];
  /** The clips' source stretches and speeds: fillers and pauses are cut in 1× clips only. */
  clips: readonly (Span & { speed: number })[];
}

/** Filler and pause cuts this close to a retake, in its clip, become part of it. */
const RETAKE_JOIN = 0.1;

/**
 * Whether `cut` (a filler or a pause) touches one of the retakes, which then takes it in: the
 * pause after the key, before the bit is said again, belongs to the retake.
 */
function joinRetake(retakes: RetakeCut[], cut: Span, clips: readonly Span[]): boolean {
  const retake = retakes.find((one) => cut.from < one.to + RETAKE_JOIN && one.from - RETAKE_JOIN < cut.to);
  const clip = retake && clips.find((span) => span.from <= retake.from && retake.to <= span.to);
  if (!retake || !clip || cut.from < clip.from || cut.to > clip.to) return false;
  retake.from = Math.min(retake.from, cut.from);
  retake.to = Math.max(retake.to, cut.to);
  return true;
}

/**
 * The project's cuts with the speech edits: the retakes (the mistake key's markers, and with a
 * transcript the spoken cues), then the filler and pause cuts of the transcript (one that touches a
 * retake joins it). The tagged cuts of the kinds made are replaced; every other cut is kept.
 */
export function withSpeechCuts(raw: Record<string, unknown>, project: CuttleProject, input: SpeechCutsInput, taken = usedIds(raw)): SpeechCutsResult {
  const { transcript } = input;
  const retakes = project.autoEdits.retakes
    ? retakeCuts({ markers: input.markers, ...(transcript && { words: transcript.words }), speech: input.speech, events: input.events, clips: input.clips })
    : [];
  const speech = transcript
    ? speechCuts(
        {
          words: transcript.words,
          sounds: transcript.sounds.map((sound) => ({ from: sound.t, to: sound.end })),
          language: transcript.language,
          still: input.still,
          events: input.events,
          clips: input.clips.filter((clip) => clip.speed === 1),
        },
        { fillers: project.autoEdits.fillers, pauses: project.autoEdits.pauses },
      ).filter((cut) => !joinRetake(retakes, cut, input.clips))
    : [];
  // without a transcript the filler and pause cuts there stay as they are: nothing to make them again from
  const kinds = transcript ? ['retake', 'filler', 'pause'] : ['retake'];
  const made = [...retakes, ...speech].sort((a, b) => a.from - b.from);
  const { cuts, added, kept } = mergeCuts((raw.cuts as RawCut[] | undefined) ?? [], made, kinds, taken);
  const fillers = added.filter((cut) => cut.auto === 'filler').length;
  const pauses = added.filter((cut) => cut.auto === 'pause').length;
  const retaken = added.filter((cut) => cut.auto === 'retake').length;
  const off = added.filter((cut) => cut.enabled === false).length;
  const notes: string[] = [];
  if (retaken > 0) notes.push(`cut ${retaken} retake${retaken === 1 ? '' : 's'}: back to the pause before each slip (the mistake key, or a spoken "nochmal" that was then said again)`);
  if (!project.autoEdits.retakes) notes.push('retake cuts are switched off (autoEdits.retakes)');
  if (fillers + pauses > 0) {
    const removed = added.filter((cut) => cut.enabled !== false && cut.auto !== 'retake').reduce((sum, cut) => sum + cut.to - cut.from, 0);
    notes.push(`cut ${fillers} filler word${fillers === 1 ? '' : 's'} and ${pauses} pause${pauses === 1 ? '' : 's'} where the picture rests (${removed.toFixed(1)} s)${off > 0 ? `; ${off} stay off, as before` : ''}`);
  }
  if (transcript && !project.autoEdits.fillers) notes.push('filler cuts are switched off (autoEdits.fillers)');
  if (transcript && !project.autoEdits.pauses) notes.push('pause cuts are switched off (autoEdits.pauses)');
  if (kept > 0) notes.push(`kept ${kept} cut${kept === 1 ? '' : 's'} made by hand or by other steps`);
  return { cuts, fillers, pauses, retakes: retaken, off, notes };
}

/** The speech of a transcript as stretches: its words, joined where they touch. */
export const wordStretches = (transcript: TranscriptFile): Span[] => union(transcript.words.map((word) => ({ from: word.t, to: word.end })));

/** The markers of markers.json; none when it cannot be read. */
export async function readMarkers(path: string): Promise<Marker[]> {
  const parsed = parseMarkersJson(await readFile(path, 'utf8').catch(() => ''));
  return parsed.ok ? parsed.markers : [];
}

export interface SpeechEditsResult extends SpeechCutsResult {
  project: string;
  written: boolean;
}

/**
 * Applies the speech edits of the project's transcript to cuttle.json, leaving its scenes and every
 * other item as they are: the app's step once the transcript arrives after the cut. `link`: a
 * transcript to link first (in the same write), which must belong to the project's mic; `cleanMic`:
 * the cleaned-up mic, linked with it.
 */
export async function applySpeechEdits(projectDir: string, options: { link?: string; cleanMic?: string; onStatus?: (text: string) => void } = {}): Promise<SpeechEditsResult> {
  const file = await readProjectFile(projectDir);
  const { sources } = file.project;
  if (options.link !== undefined) {
    if (!transcriptOfMic(file.dir, sources, options.link)) throw new CoreError('conflict', `the project moved to another take while it was transcribed: ${options.link} is not linked`);
    file.raw.sources = { ...(file.raw.sources as Record<string, unknown>), transcript: options.link, ...(options.cleanMic && { cleanMic: options.cleanMic }) };
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
  const markers = sources.markers ? await readMarkers(resolve(file.dir, sources.markers)) : [];
  const clips = file.project.scenes.flatMap((scene) => (scene.type === 'clip' ? [{ from: scene.from, to: scene.to, speed: scene.speed }] : []));
  const result = withSpeechCuts(file.raw, file.project, { transcript, markers, speech: wordStretches(transcript), still: screen.still, events, clips });
  const before = JSON.stringify(file.raw.cuts ?? []);
  const linking = (options.link !== undefined && options.link !== sources.transcript) || (options.cleanMic !== undefined && options.cleanMic !== sources.cleanMic);
  if (JSON.stringify(result.cuts) === before && !linking) return { ...result, project: file.path, written: false };
  if (result.cuts.length > 0 || file.raw.cuts !== undefined) file.raw.cuts = result.cuts;
  await writeProjectFile(file, 'the speech edits');
  return { ...result, project: file.path, written: true };
}
