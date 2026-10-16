import type { Rect, Zoom } from '@cuttle/project';
import { ease, lerpRect } from './easing';

/** Ramp length in output seconds; converted to source seconds with the scene speed. */
export const ZOOM_RAMP_SECONDS = 0.6;

export function zoomRectAt(zooms: readonly Zoom[], sourceTime: number, speed: number, full: Rect): Rect {
  let active: Zoom | undefined;
  for (const zoom of zooms) {
    if (!zoom.enabled) continue;
    if (sourceTime < zoom.at || sourceTime > zoom.at + zoom.duration) continue;
    if (!active || zoom.at >= active.at) active = zoom;
  }
  if (!active) return full;

  const ramp = Math.min(ZOOM_RAMP_SECONDS * speed, active.duration / 2);
  const sinceStart = sourceTime - active.at;
  const untilEnd = active.at + active.duration - sourceTime;
  const amount = Math.min(ease(active.ease, sinceStart / ramp), ease(active.ease, untilEnd / ramp));
  return lerpRect(full, active.rect, amount);
}
