// Speech cuts in the quiet: whisper's word times are estimates, often a tenth of a second or more
// off, and a cut edge placed by them can fall in a word's sound, which then comes out chopped. The
// mic's loudness knows where the sound is: an edge in it moves to the nearest quiet, never past a
// word that stays, keeping a little quiet next to the sound that stays; a cut with no quiet near
// enough is left out. Pure: the inputs are the mic's levels and the words, in source seconds.
import type { TranscriptWord } from '@cuttle/project';
import { union, type Span } from '../suggest/spans';
import { LEVEL_SECONDS, percentile } from './levels';

export const GUARD_RULES = {
  /** Quiet lies below the floor plus this share of the way to the loud level, in dB (floor: the 10th percentile, loud: the 98th). */
  share: 0.3,
  /** Less than this between the floor and the loud level: the mic tells nothing (muted, steady noise), and the cuts stay as made. */
  minRange: 12,
  /** A quiet gap shorter than this is a stop inside a word ("t", "k"), not quiet. */
  minQuiet: 0.06,
  /** An edge moves at most this far. */
  reach: 0.4,
  /** An edge lies at least this far inside the quiet … */
  margin: 0.03,
  /** … and this far from the sound that stays, as far as the quiet reaches (the retakes keep as much). */
  keep: 0.15,
};

const ms = (seconds: number) => Math.round(seconds * 1000) / 1000;

/**
 * Where the mic is quiet, on the screen track's time (`offset`: where the mic starts on it): the
 * stretches below the quiet threshold, at least `minQuiet` long, and everything before the mic
 * starts and after it ends. Undefined when the mic hears no speech.
 */
export function quietStretches(levels: Float32Array, offset = 0, rules = GUARD_RULES): Span[] | undefined {
  if (levels.length === 0) return undefined;
  const sorted = Float32Array.from(levels).sort();
  const floor = percentile(sorted, 0.1);
  const loud = percentile(sorted, 0.98);
  if (loud - floor < rules.minRange) return undefined;
  const threshold = floor + rules.share * (loud - floor);
  const at = (i: number) => ms(offset + i * LEVEL_SECONDS);
  const runs: Span[] = [{ from: -Infinity, to: at(0) }];
  let start: number | undefined;
  for (let i = 0; i <= levels.length; i++) {
    const quiet = i < levels.length && levels[i]! < threshold;
    if (quiet && start === undefined) start = i;
    else if (!quiet && start !== undefined) {
      runs.push({ from: at(start), to: at(i) });
      start = undefined;
    }
  }
  runs.push({ from: at(levels.length), to: Infinity });
  return union(runs).filter((span) => span.to - span.from >= rules.minQuiet);
}

/**
 * The quiet stretch `at` lies in (`margin` inside it), else the quiet point in `[lo, hi]` nearest to
 * it, with its stretch; undefined when there is none.
 */
function settle(at: number, lo: number, hi: number, quiet: readonly Span[], margin: number): { at: number; span: Span } | undefined {
  let best: { at: number; span: Span } | undefined;
  for (const span of quiet) {
    const a = Math.max(span.from + margin, lo);
    const b = Math.min(span.to - margin, hi);
    if (span.from + margin <= at && at <= span.to - margin) return { at, span };
    if (a > b) continue;
    const point = Math.min(b, Math.max(a, at));
    if (best === undefined || Math.abs(point - at) < Math.abs(best.at - at)) best = { at: point, span };
  }
  return best;
}

/**
 * The cut with its edges in the mic's quiet (`quietStretches`), `margin` inside it. An edge in sound
 * moves to the nearest quiet within `reach`: the start never before the end of the word that stays
 * before the cut nor after the start of the first word it removes, the end never before the end of
 * the last word it removes nor after the start of the word that stays after it (a word is removed
 * when its middle lies in the cut). Then each edge keeps `keep` of its quiet next to the sound that
 * stays (before the start, after the end), as far as the quiet reaches. Undefined when an edge finds
 * no quiet.
 */
export function guardCut<T extends Span>(cut: T, words: readonly TranscriptWord[], quiet: readonly Span[], rules = GUARD_RULES): T | undefined {
  const middle = (word: TranscriptWord) => (word.t + word.end) / 2;
  const before = words.filter((word) => middle(word) < cut.from).at(-1);
  const removed = words.filter((word) => cut.from <= middle(word) && middle(word) < cut.to);
  const after = words.find((word) => middle(word) >= cut.to);
  const start = settle(cut.from, Math.max(before?.end ?? -Infinity, cut.from - rules.reach), Math.min(removed[0]?.t ?? Infinity, cut.from + rules.reach, cut.to), quiet, rules.margin);
  const end = settle(cut.to, Math.max(removed.at(-1)?.end ?? -Infinity, cut.to - rules.reach, cut.from), Math.min(after?.t ?? Infinity, cut.to + rules.reach), quiet, rules.margin);
  if (!start || !end) return undefined;
  const from = Math.max(start.at, Math.min(start.span.from + rules.keep, start.span.to - rules.margin));
  const to = Math.min(end.at, Math.max(end.span.to - rules.keep, end.span.from + rules.margin));
  if (!(to > from)) return undefined;
  return from === cut.from && to === cut.to ? cut : { ...cut, from: ms(from), to: ms(to) };
}
