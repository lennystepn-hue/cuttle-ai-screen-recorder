import type { Rect, Zoom } from '@cuttle/project';
import { clamp, ease, lerpRect } from './easing';

/** Ramp length in output seconds; converted to source seconds with the scene speed. */
export const ZOOM_RAMP_SECONDS = 0.6;

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

/** Crop rect at `sourceTime` (source seconds); `speed` scales the 0.6 s output ramp, `full` is the screen rect in source pixels, overlapping zooms fold in `at` order, and the result is a new array. */
export function zoomRectAt(zooms: readonly Zoom[], sourceTime: number, speed: number, full: Rect): Rect {
  const active = zooms
    .filter((zoom) => zoom.enabled && sourceTime >= zoom.at && sourceTime < zoom.at + zoom.duration)
    .sort((a, b) => a.at - b.at);

  let rect: Rect = [...full];
  for (const zoom of active) {
    const ramp = Math.min(ZOOM_RAMP_SECONDS * speed, zoom.duration / 2);
    const sinceStart = sourceTime - zoom.at;
    const untilEnd = zoom.at + zoom.duration - sourceTime;
    const amount = Math.min(ease(zoom.ease, sinceStart / ramp), ease(zoom.ease, untilEnd / ramp));
    rect = lerpRect(rect, fitZoomRect(zoom.rect, full), amount);
  }
  return rect;
}
