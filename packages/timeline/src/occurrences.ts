import type { Ease } from '@cuttle/project';
import { ease } from './easing';
import { CONTINUOUS_CUT_SECONDS, isContinuousCut, type SceneSpan } from './time';

/**
 * One stretch of output time that shows an overlay (a zoom or a text, whose range is in source
 * seconds): a run of clips that show part of its range, joined over continuous cuts. `start` and
 * `end` are output seconds.
 */
export interface Occurrence {
  start: number;
  end: number;
  /** It shows the overlay's start, so the overlay ramps in; a cut into the middle lands on it fully. */
  rampIn: boolean;
  /** It shows the overlay's end, so the overlay ramps out. */
  rampOut: boolean;
}

/**
 * The occurrence of the overlay with source range `[start, end)` in each span: `undefined` where
 * the span does not show it; spans joined by a continuous cut share one object. An overlay end that
 * lies within a continuous cut's tolerance of a clip's end counts as shown there (it ramps).
 */
export function occurrences(spans: readonly SceneSpan[], start: number, end: number): (Occurrence | undefined)[] {
  const result: (Occurrence | undefined)[] = [];
  spans.forEach((span, i) => {
    const scene = span.scene;
    const from = scene.type === 'clip' ? Math.max(start, scene.from) : 0;
    const to = scene.type === 'clip' ? Math.min(end, scene.to) : 0;
    if (scene.type !== 'clip' || to <= from) {
      result.push(undefined);
      return;
    }
    const outEnd = Math.min(span.end, span.start + (to - scene.from) / scene.speed);
    const previous = result[i - 1];
    const rampOut = end <= scene.to + CONTINUOUS_CUT_SECONDS;
    if (previous && isContinuousCut(spans[i - 1]!.scene, scene)) {
      previous.end = outEnd;
      previous.rampOut = rampOut;
      result.push(previous);
      return;
    }
    result.push({ start: span.start + (from - scene.from) / scene.speed, end: outEnd, rampIn: start >= scene.from - CONTINUOUS_CUT_SECONDS, rampOut });
  });
  return result;
}

/**
 * How far an overlay is in (0 to 1) at output time `t` of its occurrence: it ramps in over `ramp`
 * output seconds from the occurrence's start and out over `ramp` before its end, where it has those
 * ends; the ramps shrink to fit a short occurrence.
 */
export function rampAmount(occurrence: Occurrence, t: number, ramp: number, curve: Ease): number {
  const ramps = Number(occurrence.rampIn) + Number(occurrence.rampOut);
  if (ramps === 0) return 1;
  const length = Math.min(ramp, (occurrence.end - occurrence.start) / ramps);
  if (!(length > 0)) return 0;
  const rampIn = occurrence.rampIn ? ease(curve, (t - occurrence.start) / length) : 1;
  const rampOut = occurrence.rampOut ? ease(curve, (occurrence.end - t) / length) : 1;
  return Math.min(rampIn, rampOut);
}
