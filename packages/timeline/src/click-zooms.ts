// Zooms that follow the clicks of a take: clicks close in time and place make one zoom that eases
// in as the first click happens, stays while the work goes on there, and leaves. Fewer, better
// zooms: never in waiting that is sped up, never one that would barely zoom, never two at once, and
// at most one starting in any 5 output seconds. Pure; `suggest` and the editor share it.
import type { InputEvent, Rect } from '@cuttle/project';

/** A click joins the zoom being formed when it comes this soon after its last click (source s)… */
export const CLUSTER_GAP_SECONDS = 3;
/** …and the clicks' box with it stays within this share of the screen's width and height. */
export const CLUSTER_SPAN = 0.4;
/** Room around the clicks, as a share of the screen's width. */
export const PAD = 0.1;
/** A zoom shows at least this share of the screen's width (at most about 2.2× zoom). */
export const MIN_WIDTH = 0.45;
/** A zoom that would show more than this share of the screen's area barely zooms: none. */
export const MAX_AREA = 0.8;
/** The zoom starts this long before the first click (it eases in for 0.6 s)… */
export const LEAD_SECONDS = 0.7;
/** …and lasts until this long after the last one, at least `MIN_SECONDS`. */
export const TAIL_SECONDS = 1.2;
export const MIN_SECONDS = 1.8;
/** Clicks in clips faster than this are not zoomed (waiting sped up). */
export const MAX_SPEED = 2;
/** Two zooms that overlap this much (of the smaller) and are this close in time become one. */
export const MERGE_OVERLAP = 0.6;
export const MERGE_GAP_SECONDS = 1.5;
/** At most one zoom starts in any this many output seconds. */
export const MIN_OUTPUT_GAP = 5;
/** No zoom starts or ends this close to its clip's cut (a cut and a zoom at once is too much). */
export const EDGE_SECONDS = 1;

export interface ClipSpan {
  from: number;
  to: number;
  speed: number;
}

export interface ClickZoom {
  at: number;
  duration: number;
  rect: Rect;
  /** How many clicks it follows. */
  clicks: number;
}

type Box = { left: number; top: number; right: number; bottom: number };

const boxOf = (points: readonly { x: number; y: number }[]): Box => ({
  left: Math.min(...points.map((point) => point.x)),
  top: Math.min(...points.map((point) => point.y)),
  right: Math.max(...points.map((point) => point.x)),
  bottom: Math.max(...points.map((point) => point.y)),
});

/** A box padded, made at least `MIN_WIDTH` wide in the screen's aspect, and kept on the screen. */
export function zoomRectFor(box: Box, screen: { width: number; height: number }): Rect {
  const pad = PAD * screen.width;
  const aspect = screen.width / screen.height;
  let width = Math.max(box.right - box.left + 2 * pad, MIN_WIDTH * screen.width);
  let height = Math.max(box.bottom - box.top + 2 * pad, width / aspect);
  width = Math.max(width, height * aspect);
  height = width / aspect;
  width = Math.min(width, screen.width);
  height = Math.min(height, screen.height);
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const x = Math.min(Math.max(cx - width / 2, 0), screen.width - width);
  const y = Math.min(Math.max(cy - height / 2, 0), screen.height - height);
  return [Math.round(x), Math.round(y), Math.round(width), Math.round(height)];
}

/** The share of the smaller rect that the two cover together. */
function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a[2] * a[3], b[2] * b[3]);
}

/**
 * The zooms for a take's left clicks inside `clips` (in output order), in source seconds and
 * pixels. `avoid` are spans other zooms already take (the answer zoom): no click zoom overlaps one.
 */
export function clickZooms(events: readonly InputEvent[], clips: readonly ClipSpan[], screen: { width: number; height: number }, avoid: readonly { at: number; duration: number }[] = []): ClickZoom[] {
  // output seconds where each clip starts, to space the zooms out as people see them
  const starts: number[] = [];
  let shown = 0;
  for (const clip of clips) {
    starts.push(shown);
    shown += (clip.to - clip.from) / clip.speed;
  }
  const clipOf = (t: number) => clips.findIndex((clip) => t >= clip.from && t < clip.to);
  const outputAt = (t: number, index: number) => starts[index]! + (t - clips[index]!.from) / clips[index]!.speed;

  const clicks = events
    .filter((event): event is Extract<InputEvent, { type: 'click' }> => event.type === 'click' && event.button === 'left')
    .map((click) => ({ ...click, clip: clipOf(click.t) }))
    .filter((click) => click.clip >= 0 && clips[click.clip]!.speed <= MAX_SPEED)
    .sort((a, b) => a.t - b.t);

  // clusters: close in time, within one clip, and in one part of the screen
  const clusters: (typeof clicks)[] = [];
  for (const click of clicks) {
    const open = clusters.at(-1);
    const last = open?.at(-1);
    if (open && last && last.clip === click.clip && click.t - last.t <= CLUSTER_GAP_SECONDS) {
      const box = boxOf([...open, click]);
      if (box.right - box.left <= CLUSTER_SPAN * screen.width && box.bottom - box.top <= CLUSTER_SPAN * screen.height) {
        open.push(click);
        continue;
      }
    }
    clusters.push([click]);
  }

  let zooms = clusters.flatMap((cluster) => {
    const clip = clips[cluster[0]!.clip]!;
    const at = Math.max(cluster[0]!.t - LEAD_SECONDS, clip.from + EDGE_SECONDS);
    const end = Math.min(Math.max(cluster.at(-1)!.t + TAIL_SECONDS, at + MIN_SECONDS), clip.to - EDGE_SECONDS);
    if (end - at < MIN_SECONDS - 1e-9) return [];
    return [{ at, end, clip: cluster[0]!.clip, points: cluster.map(({ x, y }) => ({ x, y })), clicks: cluster.length }];
  });

  // neighbours that show nearly the same spot become one
  const merged: typeof zooms = [];
  for (const zoom of zooms) {
    const previous = merged.at(-1);
    if (previous && previous.clip === zoom.clip && zoom.at - previous.end <= MERGE_GAP_SECONDS && overlap(zoomRectFor(boxOf(previous.points), screen), zoomRectFor(boxOf(zoom.points), screen)) >= MERGE_OVERLAP) {
      previous.end = Math.max(previous.end, zoom.end);
      previous.points.push(...zoom.points);
      previous.clicks += zoom.clicks;
      continue;
    }
    merged.push({ ...zoom, points: [...zoom.points] });
  }
  zooms = merged;

  const result: ClickZoom[] = [];
  let lastStart = -Infinity;
  let lastEnd = -Infinity;
  for (const zoom of zooms) {
    const rect = zoomRectFor(boxOf(zoom.points), screen);
    if ((rect[2] * rect[3]) / (screen.width * screen.height) > MAX_AREA) continue;
    if (avoid.some((other) => zoom.at < other.at + other.duration && other.at < zoom.end)) continue;
    // one at a time, and not too often
    const start = outputAt(zoom.at, zoom.clip);
    if (zoom.at < lastEnd || start - lastStart < MIN_OUTPUT_GAP) continue;
    result.push({ at: round(zoom.at), duration: round(zoom.end - zoom.at), rect, clicks: zoom.clicks });
    lastStart = start;
    lastEnd = zoom.end;
  }
  return result;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
