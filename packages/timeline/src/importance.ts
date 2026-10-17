// Fitting a video to a length: how much each moment matters, and which ones to cut. Each quarter
// second of the output gets a level: high where something happens that the video is for (speech, a
// click, typing, Claude's answer, a text on screen, the first second of a scene), middle where the
// screen changes or the pointer moves, low where it rests. The fit cuts the longest low runs first,
// then the middle ones, never a high one: never inside a word, never near a click. Pure.
import type { InputEvent } from '@cuttle/project';
import type { SceneSpan } from './time';

/** A stretch of source seconds. */
export interface SourceSpan {
  from: number;
  to: number;
}

export const LENGTH_RULES = {
  /** Output seconds per level. */
  slot: 0.25,
  /** The first this many output seconds of a scene stay. */
  sceneStart: 1,
  /** Source seconds kept around a click. */
  clickGuard: 0.3,
  /** A key count covers this many source seconds from its time (the recorder's window). */
  keyWindow: 0.5,
  /** The shortest cut (output seconds); a shorter run stays. */
  minCut: 0.6,
  /** Output seconds left at each end of a run that is cut, so a cut never meets what stays head on. */
  margin: 0.1,
  /** Within this many output seconds over the target the video fits: no cut for less. */
  close: 0.125,
};

export type Level = 0 | 1 | 2;
export const LOW: Level = 0;
export const MIDDLE: Level = 1;
export const HIGH: Level = 2;

export interface ImportanceInput {
  /** The output timeline (`sceneSpans` with the cuts that stay). */
  spans: readonly SceneSpan[];
  /** Where someone speaks (source seconds): the words, padded. */
  speech: readonly SourceSpan[];
  /** The take's input: clicks and keys are high, the pointer moving and scrolls middle. */
  events: readonly InputEvent[];
  /** Where the screen changed (source seconds). */
  changes: readonly SourceSpan[];
  /** Other stretches that must stay (source seconds): the answer's zoom, texts on screen. */
  keep?: readonly SourceSpan[];
}

const overlaps = (spans: readonly SourceSpan[], from: number, to: number) => spans.some((span) => span.from < to && from < span.to);

/**
 * The level of each `slot` of the output timeline, from 0: a still or a card is high (only clips
 * are cut), a clip's slot by what its source stretch holds.
 */
export function importance(input: ImportanceInput, rules = LENGTH_RULES): Level[] {
  const total = input.spans.at(-1)?.end ?? 0;
  const high: SourceSpan[] = [...input.speech, ...(input.keep ?? [])];
  const middle: SourceSpan[] = [...input.changes];
  for (const event of input.events) {
    if (event.type === 'click') high.push({ from: event.t - rules.clickGuard, to: event.t + rules.clickGuard });
    else if (event.type === 'keys') high.push({ from: event.t, to: event.t + rules.keyWindow });
    else if (event.type === 'move' || event.type === 'scroll') middle.push({ from: event.t - rules.slot / 2, to: event.t + rules.slot / 2 });
  }
  /** Where each scene starts on the output timeline (its first piece; a cut's piece is not a new scene). */
  const sceneStarts = input.spans.filter((span) => !span.cutBefore).map((span) => span.start);
  const levels: Level[] = [];
  for (let k = 0; k * rules.slot < total - 1e-9; k++) {
    const start = k * rules.slot;
    const end = Math.min(total, start + rules.slot);
    const span = input.spans.find((candidate) => candidate.start <= start + 1e-9 && start < candidate.end - 1e-9) ?? input.spans.at(-1)!;
    const scene = span.scene;
    if (scene.type !== 'clip' || sceneStarts.some((at) => start < at + rules.sceneStart - 1e-9 && at <= start + 1e-9)) {
      levels.push(HIGH);
      continue;
    }
    const from = scene.from + (start - span.start) * scene.speed;
    const to = scene.from + (Math.min(end, span.end) - span.start) * scene.speed;
    levels.push(overlaps(high, from, to) ? HIGH : overlaps(middle, from, to) ? MIDDLE : LOW);
  }
  return levels;
}

export interface LengthFit {
  /** The cuts to make, in source seconds, in order. */
  cuts: SourceSpan[];
  /** The video's length with them (output seconds). */
  length: number;
  /** Whether it reaches the target; when not, `length` is the shortest the fit could make. */
  reached: boolean;
}

/**
 * The cuts that bring the video to `target` output seconds: runs of slots at the lowest level
 * first (low, then low and middle), the longest first, each kept `margin` from what stays; the
 * last one only as much as is needed (at least `minCut`), from its middle: the video lands within
 * `close` over the target, or up to `minCut` under it. A run shorter than `minCut` stays. High
 * slots are never cut: when that is not enough, the fit makes the video as short as it can.
 */
export function fitLength(input: ImportanceInput, target: number, rules = LENGTH_RULES): LengthFit {
  const total = input.spans.at(-1)?.end ?? 0;
  const levels = importance(input, rules);
  const cut = new Array<boolean>(levels.length).fill(false);
  /** Output stretches cut, each inside one span. */
  const taken: { span: SceneSpan; from: number; to: number }[] = [];
  let need = total - target;
  for (const level of [LOW, MIDDLE] as const) {
    if (need <= rules.close) break;
    // runs of slots at this level or lower, not cut yet, each inside one span
    const runs: { span: SceneSpan; from: number; to: number }[] = [];
    for (const span of input.spans) {
      if (span.scene.type !== 'clip') continue;
      let open: number | undefined;
      const close = (k: number) => {
        if (open === undefined) return;
        const from = Math.max(span.start, open * rules.slot) + rules.margin;
        const to = Math.min(span.end, k * rules.slot) - rules.margin;
        if (to - from >= rules.minCut - 1e-9) runs.push({ span, from, to });
        open = undefined;
      };
      const first = Math.floor((span.start + 1e-9) / rules.slot);
      const last = Math.ceil((span.end - 1e-9) / rules.slot);
      for (let k = first; k < last; k++) {
        // a slot shared with the span before or after counts for this span only when it lies mostly in it
        const inside = Math.min(span.end, (k + 1) * rules.slot) - Math.max(span.start, k * rules.slot) >= rules.slot / 2 - 1e-9;
        if (inside && !cut[k] && levels[k]! <= level) open ??= k;
        else close(k);
      }
      close(last);
    }
    runs.sort((a, b) => b.to - b.from - (a.to - a.from) || a.from - b.from);
    for (const run of runs) {
      if (need <= rules.close) break;
      const length = run.to - run.from;
      // the whole run, or as much as is needed from its middle (never less than minCut)
      const take = Math.min(length, Math.max(need, rules.minCut));
      const middle = (run.from + run.to) / 2;
      const piece = take >= length - 1e-9 ? run : { span: run.span, from: middle - take / 2, to: middle + take / 2 };
      taken.push(piece);
      for (let k = Math.floor(piece.from / rules.slot); k < Math.ceil(piece.to / rules.slot); k++) cut[k] = true;
      need -= piece.to - piece.from;
    }
  }
  const round = (seconds: number) => Math.round(seconds * 1000) / 1000;
  const cuts = taken
    .map(({ span, from, to }) => {
      const scene = span.scene as Extract<SceneSpan['scene'], { type: 'clip' }>;
      return { from: round(scene.from + (from - span.start) * scene.speed), to: round(scene.from + (to - span.start) * scene.speed) };
    })
    .sort((a, b) => a.from - b.from);
  const removed = taken.reduce((sum, piece) => sum + piece.to - piece.from, 0);
  return { cuts, length: round(total - removed), reached: total - removed <= target + rules.close + 1e-9 };
}
