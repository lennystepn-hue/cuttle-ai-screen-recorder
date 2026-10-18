// Zooms on dialogs: a dialog that stays open at least a second over the screen gets a zoom on it,
// padded, from just before it opens to just after it closes. The recorder logs when one opens and
// closes (`window` events). Pure.
import type { InputEvent, Rect } from '@cuttle/project';
import { minZoomWidth, type ClipSpan, type ZoomScreen } from '@cuttle/timeline';

export const DIALOG_RULES = {
  /** A dialog open at least this long (output s) gets a zoom… */
  minOpen: 1,
  /** …from this long before it opens to this long after it closes (output s). */
  before: 0.3,
  after: 0.3,
  /** Room around the dialog: this share of its larger side… */
  pad: 0.15,
  /** …in a view at least this share of the screen's width (at most about 2.2×). */
  minWidth: 0.45,
  /** A dialog less than this share inside the screen is on another monitor: none. */
  inside: 0.9,
  /** A zoom that would show more than this share of the screen's area barely zooms: none. */
  maxArea: 0.8,
  /** Dialogs in clips faster than this are not zoomed (waiting sped up). */
  maxSpeed: 2,
};

export interface DialogZoom {
  at: number;
  duration: number;
  rect: Rect;
}

/**
 * The zooms for the dialogs in `clips`, in source seconds and pixels: each from `before` its opening
 * to `after` its closing (the take's end when it never closed), inside the clip it opened in, padded
 * as a click zoom is. None overlaps a zoom of `avoid` or another dialog's.
 */
export function dialogZooms(events: readonly InputEvent[], clips: readonly ClipSpan[], screen: ZoomScreen, avoid: readonly { at: number; duration: number }[] = [], rules = DIALOG_RULES): DialogZoom[] {
  const windows = events.flatMap((event) => (event.type === 'window' && event.kind === 'dialog' ? [event] : [])).sort((a, b) => a.t - b.t);
  const result: DialogZoom[] = [];
  for (const opened of windows.filter((event) => event.open)) {
    const clip = clips.find((span) => opened.t >= span.from && opened.t < span.to);
    if (!clip || clip.speed > rules.maxSpeed) continue;
    const closed = windows.find((event) => !event.open && event.id === opened.id && event.t > opened.t)?.t ?? clip.to;
    const s = clip.speed;
    if ((Math.min(closed, clip.to) - opened.t) / s < rules.minOpen) continue;
    const [x, y, width, height] = opened.rect;
    const inside = Math.max(0, Math.min(screen.width, x + width) - Math.max(0, x)) * Math.max(0, Math.min(screen.height, y + height) - Math.max(0, y));
    if (inside < rules.inside * width * height) continue;
    const rect = dialogRect(opened.rect, screen, rules);
    if ((rect[2] * rect[3]) / (screen.width * screen.height) > rules.maxArea) continue;
    const at = Math.max(clip.from, opened.t - rules.before * s);
    const end = Math.min(clip.to, closed + rules.after * s);
    if ([...avoid, ...result].some((other) => at < other.at + other.duration && other.at < end)) continue;
    result.push({ at: round(at), duration: round(end - at), rect });
  }
  return result;
}

/** The view on a dialog: padded by `pad` of its larger side, at least `minWidth` wide (as many points on a scaled display), in the screen's shape, on the screen. */
function dialogRect([x, y, width, height]: Rect, screen: ZoomScreen, rules: typeof DIALOG_RULES): Rect {
  const aspect = screen.width / screen.height;
  const pad = rules.pad * Math.max(width, height);
  let w = Math.max(width + 2 * pad, (height + 2 * pad) * aspect, minZoomWidth(screen, rules.minWidth));
  w = Math.min(w, screen.width);
  const h = Math.min(w / aspect, screen.height);
  const left = Math.min(Math.max(x + width / 2 - w / 2, 0), screen.width - w);
  const top = Math.min(Math.max(y + height / 2 - h / 2, 0), screen.height - h);
  return [Math.round(left), Math.round(top), Math.round(w), Math.round(h)];
}

const round = (value: number) => Math.round(value * 1000) / 1000;
