// The length fit in a project: the cuts that bring the video to a length (`fitLength` over what
// matters in the take), merged with the cuts there by the tag rules (`auto: "length"`). `suggest
// --length` makes it as part of its run; the app makes it again from its Length control.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEventsJsonl, usedIds, type CuttleProject, type InputEvent } from '@cuttle/project';
import { fitLength, sceneSpans } from '@cuttle/timeline';
import { readProjectFile, writeProjectFile } from '../project-file';
import { speechActivity } from '../speech/apply';
import { mergeCuts, type RawCut } from '../speech/edits';
import { readTranscript } from '../speech/transcribe';
import { cachedAnalysis } from './media';
import { gaps, type Span } from './spans';

/** What the take holds, in source seconds. */
export interface LengthInput {
  /** Where someone speaks. */
  speech: readonly Span[];
  events: readonly InputEvent[];
  /** Where the screen did not change, and the take's length. */
  still: readonly Span[];
  duration: number;
}

export interface LengthFitResult {
  /** Every cut afterwards. */
  cuts: RawCut[];
  /** The asked length, the length before and after (output seconds), and whether it fits. */
  target: number;
  before: number;
  length: number;
  reached: boolean;
  /** How many cuts the fit made. */
  made: number;
  notes: string[];
}

const ms = (seconds: number) => Math.round(seconds * 10) / 10;

/**
 * The project's cuts with a length fit to `target` output seconds: the fit's cuts from before
 * (`auto: "length"`) go, the others stay and are counted; what must stay besides speech, clicks and
 * typing is every zoom (made by hand or by Cuttle: it shows what matters, Claude's answer too) and
 * every text on screen.
 */
export function withLengthFit(raw: Record<string, unknown>, project: CuttleProject, input: LengthInput, target: number, taken = usedIds(raw)): LengthFitResult {
  const others = project.cuts.filter((cut) => cut.auto !== 'length');
  const spans = sceneSpans(project.scenes, others);
  const before = spans.at(-1)?.end ?? 0;
  const keep = [
    ...project.zooms.filter((zoom) => zoom.enabled).map((zoom) => ({ from: zoom.at, to: zoom.at + zoom.duration })),
    ...project.texts.filter((text) => text.enabled).map((text) => ({ from: text.at, to: text.at + text.duration })),
  ];
  const fit = fitLength({ spans, speech: input.speech, events: input.events, changes: gaps(input.still, 0, input.duration), keep }, target);
  const label = `Fit to ${ms(target)} s`;
  const merged = mergeCuts((raw.cuts as RawCut[] | undefined) ?? [], fit.cuts.map((cut) => ({ ...cut, auto: 'length', label })), ['length'], taken);
  const notes: string[] = [];
  if (fit.cuts.length === 0 && fit.reached) notes.push(`the video is ${ms(before)} s: it fits ${ms(target)} s, nothing cut to fit`);
  else if (fit.reached) notes.push(`cut ${ms(before - fit.length)} s where the video rests (${fit.cuts.length} cut${fit.cuts.length === 1 ? '' : 's'}) to fit ${ms(target)} s: ${ms(fit.length)} s now`);
  else notes.push(`shortest without cutting speech, clicks, typing, a zoom or a text: ${ms(fit.length)} s (${ms(target)} s asked)`);
  return { cuts: merged.cuts, target, before, length: fit.length, reached: fit.reached, made: fit.cuts.length, notes };
}

/** The project's cuts without the length fit's. */
export function withoutLengthFit(raw: Record<string, unknown>): RawCut[] {
  return mergeCuts((raw.cuts as RawCut[] | undefined) ?? [], [], ['length'], usedIds(raw)).cuts;
}

export interface LengthApplied extends Omit<LengthFitResult, 'cuts'> {
  /** Whether cuttle.json was written (nothing changed: not written). */
  written: boolean;
}

/**
 * Fits the project (`dir`: its folder) to `target` output seconds, or takes the fit out (no
 * target), and writes it when something changed. The screen's analysis is the one suggest kept
 * in the project (read again only when the take changed).
 */
export async function applyLengthFit(dir: string, target?: number): Promise<LengthApplied> {
  const file = await readProjectFile(dir);
  const { sources } = file.project;
  const old = JSON.stringify((file.raw.cuts as unknown[] | undefined) ?? []);
  let result: LengthFitResult;
  if (target === undefined) {
    const cuts = withoutLengthFit(file.raw);
    const length = sceneSpans(file.project.scenes, file.project.cuts.filter((cut) => cut.auto !== 'length')).at(-1)?.end ?? 0;
    result = { cuts, target: length, before: length, length, reached: true, made: 0, notes: ['the length fit is taken out'] };
  } else {
    const analysis = await cachedAnalysis(resolve(file.dir, sources.screen), file.dir);
    const { transcript } = await readTranscript(file.dir, sources.transcript);
    const speech = await speechActivity(file.dir, sources, transcript);
    const text = sources.events ? await readFile(resolve(file.dir, sources.events), 'utf8').catch(() => undefined) : undefined;
    const events = text === undefined ? [] : parseEventsJsonl(text).events;
    result = withLengthFit(file.raw, file.project, { speech: speech.spans, events, still: analysis.still, duration: analysis.duration }, target);
  }
  const { cuts, ...rest } = result;
  if (JSON.stringify(cuts) === old) return { ...rest, written: false };
  file.raw.cuts = cuts;
  await writeProjectFile(file, 'the length fit');
  return { ...rest, written: true };
}
