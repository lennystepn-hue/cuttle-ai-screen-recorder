// The editor's gestures as pure functions: snapping in output time, what a drag on the timeline
// does to an item's source times, and the mapping between the stage and the screen's pixels in the
// source view. Pure, so they are tested without a window.
import type { Rect } from '@cuttle/project';

/** A time snapped to the nearest target within `tolerance` (output seconds), else to the frame grid. */
export function snapTime(t: number, targets: readonly number[], tolerance: number, fps: number): { t: number; target?: number } {
  let best: number | undefined;
  for (const target of targets) if (Math.abs(target - t) <= tolerance && (best === undefined || Math.abs(target - t) < Math.abs(best - t))) best = target;
  if (best !== undefined) return { t: best, target: best };
  return { t: Math.round(t * fps) / fps };
}

/** An overlay's source range: a mask's from and to, a zoom's or caption's at and at + duration. */
export function overlayRange(item: { from?: number; to?: number; at?: number; duration?: number }): [number, number] {
  return item.from !== undefined && item.to !== undefined ? [item.from, item.to] : [item.at ?? 0, (item.at ?? 0) + (item.duration ?? 0)];
}

/** The fields that give an overlay of `list` the source range [from, to) (a sound: its moment, `from`). */
export function rangeFields(list: 'zooms' | 'masks' | 'texts' | 'annotations' | 'overlays' | 'sounds', from: number, to: number): Record<string, number> {
  if (list === 'sounds') return { at: from };
  return list === 'masks' ? { from, to } : { at: from, duration: to - from };
}

/**
 * The source range after dragging an overlay's `edge` (or the whole block, `move`) by `deltaOut`
 * output seconds inside a clip played at `speed`; at least `minimum` source seconds long, never
 * before 0.
 */
export function dragRange(range: readonly [number, number], edge: 'start' | 'end' | 'move', deltaOut: number, speed: number, minimum: number): [number, number] {
  const delta = deltaOut * speed;
  let [from, to] = range;
  if (edge === 'move') {
    const by = Math.max(delta, -from);
    return [from + by, to + by];
  }
  if (edge === 'start') from = Math.min(Math.max(0, from + delta), to - minimum);
  else to = Math.max(to + delta, from + minimum);
  return [from, to];
}

/**
 * A zoom's or mask's path (its rect and its moves' rects) moved and scaled the way the rect shown at
 * the playhead went from `from` to `to`: what the person drags is where it is then, and the rest of
 * the path follows.
 */
export function movePath(path: { rect: Rect; moves?: readonly { at: number; rect: Rect }[] }, from: Rect, to: Rect): { rect: Rect; moves?: { at: number; rect: Rect }[] } {
  const [sx, sy] = [to[2] / from[2], to[3] / from[3]];
  const map = (rect: Rect): Rect => [Math.round(to[0] + (rect[0] - from[0]) * sx), Math.round(to[1] + (rect[1] - from[1]) * sy), Math.round(rect[2] * sx), Math.round(rect[3] * sy)];
  return { rect: map(path.rect), ...(path.moves && { moves: path.moves.map((move) => ({ at: move.at, rect: map(move.rect) })) }) };
}

/** Where a picture of `source` size sits inside `area` (contained, centred): its offset and scale. */
export interface Fit {
  x: number;
  y: number;
  scale: number;
}

export function fitInside(area: { width: number; height: number }, source: { width: number; height: number }): Fit {
  const scale = Math.min(area.width / source.width, area.height / source.height);
  return { x: (area.width - source.width * scale) / 2, y: (area.height - source.height * scale) / 2, scale };
}

/** A point on the stage in source pixels (not clamped). */
export const toSource = (point: { x: number; y: number }, fit: Fit) => ({ x: (point.x - fit.x) / fit.scale, y: (point.y - fit.y) / fit.scale });

/** A source rectangle `[x, y, w, h]` on the stage. */
export const toStage = (rect: Rect | readonly number[], fit: Fit) => ({ x: fit.x + rect[0]! * fit.scale, y: fit.y + rect[1]! * fit.scale, width: rect[2]! * fit.scale, height: rect[3]! * fit.scale });

/**
 * The rectangle a drag from `a` to `b` (source pixels) draws, inside the screen. With `aspect`
 * (width / height) it keeps that shape, as a zoom does (what is drawn is what the zoom shows).
 */
export function drawnRect(a: { x: number; y: number }, b: { x: number; y: number }, screen: { width: number; height: number }, aspect?: number): Rect {
  const clampX = (x: number) => Math.min(Math.max(x, 0), screen.width);
  const clampY = (y: number) => Math.min(Math.max(y, 0), screen.height);
  const x0 = clampX(a.x);
  const y0 = clampY(a.y);
  let w = clampX(b.x) - x0;
  let h = clampY(b.y) - y0;
  if (aspect) {
    // the larger side leads; the other follows, and both shrink to stay inside
    if (Math.abs(w) / aspect > Math.abs(h)) h = Math.sign(h || 1) * (Math.abs(w) / aspect);
    else w = Math.sign(w || 1) * Math.abs(h) * aspect;
    const roomX = w < 0 ? x0 : screen.width - x0;
    const roomY = h < 0 ? y0 : screen.height - y0;
    const shrink = Math.min(1, roomX / Math.max(1e-9, Math.abs(w)), roomY / Math.max(1e-9, Math.abs(h)));
    w *= shrink;
    h *= shrink;
  }
  return [Math.min(x0, x0 + w), Math.min(y0, y0 + h), Math.abs(w), Math.abs(h)];
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';

/**
 * A rectangle moved (`move`) or resized by one of its handles by (dx, dy) source pixels, inside the
 * screen and at least `minimum` pixels each way; with `aspect` a resize keeps the shape (the
 * opposite corner or edge stays where it is).
 */
export function adjustRect(rect: Rect | readonly number[], handle: Handle, dx: number, dy: number, screen: { width: number; height: number }, aspect?: number, minimum = 8): Rect {
  const [x, y, w, h] = rect as [number, number, number, number];
  if (handle === 'move') {
    return [Math.min(Math.max(x + dx, 0), screen.width - w), Math.min(Math.max(y + dy, 0), screen.height - h), w, h];
  }
  if (aspect) {
    // The side or corner opposite the handle stays; the size follows the axis that moved more.
    const sx = handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0;
    const sy = handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0;
    let width = w + sx * dx;
    let height = h + sy * dy;
    if (sx !== 0 && (sy === 0 || Math.abs(dx) >= Math.abs(dy) * aspect)) height = width / aspect;
    else width = height * aspect;
    if (width < minimum || height < minimum) {
      width = Math.max(minimum, minimum * aspect);
      height = width / aspect;
    }
    const ax = sx < 0 ? x + w : sx > 0 ? x : x + w / 2;
    const ay = sy < 0 ? y + h : sy > 0 ? y : y + h / 2;
    // the largest size that fits on the screen from the fixed point
    const roomW = sx < 0 ? ax : sx > 0 ? screen.width - ax : 2 * Math.min(ax, screen.width - ax);
    const roomH = sy < 0 ? ay : sy > 0 ? screen.height - ay : 2 * Math.min(ay, screen.height - ay);
    const scale = Math.min(1, roomW / width, roomH / height);
    width *= scale;
    height *= scale;
    return [sx < 0 ? ax - width : sx > 0 ? ax : ax - width / 2, sy < 0 ? ay - height : sy > 0 ? ay : ay - height / 2, width, height];
  }
  let left = x;
  let top = y;
  let right = x + w;
  let bottom = y + h;
  if (handle.includes('w')) left = Math.min(Math.max(0, x + dx), right - minimum);
  if (handle.includes('e')) right = Math.max(Math.min(screen.width, right + dx), left + minimum);
  if (handle.includes('n')) top = Math.min(Math.max(0, y + dy), bottom - minimum);
  if (handle.includes('s')) bottom = Math.max(Math.min(screen.height, bottom + dy), top + minimum);
  return [left, top, right - left, bottom - top];
}
