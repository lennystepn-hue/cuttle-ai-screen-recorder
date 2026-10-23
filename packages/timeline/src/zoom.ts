import type { Rect, Zoom } from '@cuttle/project';
import { clamp, ease, lerp } from './easing';

/** Length of a zoom's ramps in output seconds (see `rampAmount`; a settling ramp is 95 % in after half a second). */
export const ZOOM_RAMP_SECONDS = 0.8;
/** How long a zoom that follows takes from one rect of its path to the next: output seconds, settling (see `settle`)… */
export const ZOOM_MOVE_SECONDS = 0.8;
/** …starting this long before the move's time, so that it is three quarters there at that time. */
export const ZOOM_MOVE_LEAD = 0.3;

/** Grows `rect` around its centre to the aspect ratio of `full`, shrinks it to fit inside `full`, then shifts it inside `full`. Source pixels. */
export function fitZoomRect(rect: Rect, full: Rect): Rect {
  const aspect = full[2] / full[3];
  let w = rect[2];
  let h = rect[3];
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  if (w > full[2]) {
    w = full[2];
    h = full[3];
  }
  const cx = rect[0] + rect[2] / 2;
  const cy = rect[1] + rect[3] / 2;
  const x = clamp(cx - w / 2, full[0], full[0] + full[2] - w);
  const y = clamp(cy - h / 2, full[1], full[1] + full[3] - h);
  return [x, y, w, h];
}

/**
 * The view `t` (0 to 1) of the way from `from` to `to`, as a camera zooms: the size changes by the
 * same factor in every step (its logarithm evenly, so a zoom looks as fast at its end as at its
 * start), and the point both views show at the same place stays put. Between views of one size,
 * this pans evenly. A new array.
 */
export function zoomBetween(from: Rect, to: Rect, t: number): Rect {
  if (!(t > 0)) return [...from];
  if (t >= 1) return [...to];
  const axis = (position: number, size: number): [number, number] => {
    const ratio = to[size]! / from[size]!;
    // the share of the size's change made: the position goes along with it (linear in the size)
    const made = Math.abs(ratio - 1) < 1e-9 || !(ratio > 0) ? t : (1 - ratio ** t) / (1 - ratio);
    return [lerp(from[position]!, to[position]!, made), ratio > 0 ? from[size]! * ratio ** t : lerp(from[size]!, to[size]!, t)];
  };
  const [x, w] = axis(0, 2);
  const [y, h] = axis(1, 3);
  return [x, y, w, h];
}

/**
 * Where a zoom aims at `sourceTime` (source seconds): its `rect`, then each move's rect in turn, over
 * `ZOOM_MOVE_SECONDS` output seconds from `ZOOM_MOVE_LEAD` before the move (`speed`: the clip's,
 * which turns them into source seconds), on the move's curve (`settle` unless it says; `jump` is
 * there at its time). A move that comes while the one before is still on its way sets off from where
 * that one is: no jump, no stop.
 */
export function zoomTargetAt(zoom: Pick<Zoom, 'rect' | 'moves'>, sourceTime: number, speed = 1): Rect {
  const lead = ZOOM_MOVE_LEAD * speed;
  const length = ZOOM_MOVE_SECONDS * speed;
  let rect = zoom.rect;
  for (const move of zoom.moves ?? []) {
    const curve = move.ease ?? 'settle';
    if (curve === 'jump') {
      if (sourceTime < move.at) break;
      rect = move.rect;
      continue;
    }
    if (sourceTime <= move.at - lead) break;
    rect = zoomBetween(rect, move.rect, ease(curve, (sourceTime - (move.at - lead)) / length));
  }
  return rect;
}

/**
 * Crop rect at `sourceTime` (source seconds): the enabled zooms whose range contains it fold in
 * `at` order, each `amountOf(zoom)` (0 to 1, its ramp) of the way from the rect before it to where
 * it aims then (`zoomBetween`). `full` is the screen rect in source pixels, `speed` the clip's; the
 * result is a new array.
 */
export function zoomRectAt(zooms: readonly Zoom[], sourceTime: number, amountOf: (zoom: Zoom) => number, full: Rect, speed = 1): Rect {
  const active = zooms
    .filter((zoom) => zoom.enabled && sourceTime >= zoom.at && sourceTime < zoom.at + zoom.duration)
    .sort((a, b) => a.at - b.at);

  let rect: Rect = [...full];
  for (const zoom of active) rect = zoomBetween(rect, fitZoomRect(zoomTargetAt(zoom, sourceTime, speed), full), amountOf(zoom));
  return rect;
}
