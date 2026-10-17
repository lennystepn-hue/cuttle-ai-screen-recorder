import type { Rect, Zoom } from '@cuttle/project';
import { clamp, ease, lerpRect } from './easing';

/** Length of a zoom's ramps in output seconds (see `rampAmount`). */
export const ZOOM_RAMP_SECONDS = 0.6;
/** How long a zoom that follows takes from one rect of its path to the next: output seconds, centred on the move. */
export const ZOOM_MOVE_SECONDS = 0.6;

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
 * Where a zoom aims at `sourceTime` (source seconds): its `rect`, then each move's rect in turn,
 * eased over `ZOOM_MOVE_SECONDS` output seconds centred on the move (`speed`: the clip's, which
 * turns them into source seconds). Moves closer than that blend into one another without a jump.
 */
export function zoomTargetAt(zoom: Pick<Zoom, 'rect' | 'moves'>, sourceTime: number, speed = 1): Rect {
  const half = (ZOOM_MOVE_SECONDS / 2) * speed;
  let rect = zoom.rect;
  for (const move of zoom.moves ?? []) {
    if (sourceTime <= move.at - half) break;
    rect = lerpRect(rect, move.rect, ease('smooth', (sourceTime - (move.at - half)) / (2 * half)));
  }
  return rect;
}

/**
 * Crop rect at `sourceTime` (source seconds): the enabled zooms whose range contains it fold in
 * `at` order, each `amountOf(zoom)` (0 to 1, its ramp) of the way from the rect before it to where
 * it aims then. `full` is the screen rect in source pixels, `speed` the clip's; the result is a
 * new array.
 */
export function zoomRectAt(zooms: readonly Zoom[], sourceTime: number, amountOf: (zoom: Zoom) => number, full: Rect, speed = 1): Rect {
  const active = zooms
    .filter((zoom) => zoom.enabled && sourceTime >= zoom.at && sourceTime < zoom.at + zoom.duration)
    .sort((a, b) => a.at - b.at);

  let rect: Rect = [...full];
  for (const zoom of active) rect = lerpRect(rect, fitZoomRect(zoomTargetAt(zoom, sourceTime, speed), full), amountOf(zoom));
  return rect;
}
