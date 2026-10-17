// Zooms that follow the clicks of a take: clicks close in time and place make one zoom that eases
// in as the first click happens, stays while the work goes on there, and leaves. When the work moves
// on soon after, elsewhere, the zoom moves along to it (`moves`) instead of leaving the clicks there
// outside the view. Fewer, better zooms: never in waiting that is sped up, never one that would
// barely zoom, never two at once, and at most one starting in any 5 output seconds (counting the
// zooms that are there). Times are as people see them: output seconds, turned into source seconds at
// the clip's speed. Pure; `suggest` and the editor share it.
import type { InputEvent, Rect } from '@cuttle/project';

/** A click joins the zoom being formed when it comes this soon after its last click (output s)… */
export const CLUSTER_GAP_SECONDS = 3;
/** …and the clicks' box with it stays within this share of the screen's width and height. */
export const CLUSTER_SPAN = 0.4;
/** Room around the clicks, as a share of the screen's width. */
export const PAD = 0.1;
/** A zoom shows at least this share of the screen's width (at most about 2.2× zoom). */
export const MIN_WIDTH = 0.45;
/** A zoom that would show more than this share of the screen's area barely zooms: none. */
export const MAX_AREA = 0.8;
/** The zoom starts this long before the first click (it eases in for 0.6 s; output s)… */
export const LEAD_SECONDS = 0.7;
/** …and lasts until this long after the last one, at least `MIN_SECONDS` (output s). */
export const TAIL_SECONDS = 1.2;
export const MIN_SECONDS = 1.8;
/** Clicks in clips faster than this are not zoomed (waiting sped up). */
export const MAX_SPEED = 2;
/**
 * Two zooms that overlap this much (of the smaller), are this close (output s), and whose clicks
 * together still fit in one cluster's box become one.
 */
export const MERGE_OVERLAP = 0.6;
export const MERGE_GAP_SECONDS = 1.5;
/** At most one zoom starts in any this many output seconds. */
export const MIN_OUTPUT_GAP = 5;
/**
 * Clicks elsewhere whose zoom would start this soon after the zoom before ends (output s) are
 * followed by it: it moves there, 0.6 s before the first of them, instead of a zoom of their own
 * (which `MIN_OUTPUT_GAP` would not allow). With `LEAD_SECONDS` and `TAIL_SECONDS` it leaves no
 * click between following and a zoom of its own.
 */
export const FOLLOW_GAP_SECONDS = 3.2;
/** No zoom starts or ends this close to its clip's cut (a cut and a zoom at once is too much; output s). */
export const EDGE_SECONDS = 1;

/** A clip as the video shows it: its source range, its speed, and where it starts in the output. */
export interface ClipSpan {
  from: number;
  to: number;
  speed: number;
  /** Output seconds where the clip starts (scenes before it, cards and pages too, counted). */
  start: number;
}

export interface ClickZoom {
  at: number;
  duration: number;
  rect: Rect;
  /** Where it moves on to, for clicks elsewhere soon after (source seconds); none when it stays. */
  moves?: { at: number; rect: Rect }[];
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

/** Whether a box of clicks is small enough for one zoom (`CLUSTER_SPAN` of the screen each way). */
const fits = (box: Box, screen: { width: number; height: number }) => box.right - box.left <= CLUSTER_SPAN * screen.width && box.bottom - box.top <= CLUSTER_SPAN * screen.height;

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

const isLeftClick = (event: InputEvent): event is Extract<InputEvent, { type: 'click' }> => event.type === 'click' && event.button === 'left';

/** How many left clicks the video shows (inside `clips`), and of those outside `avoid` (the zooms there). */
export function shownClicks(events: readonly InputEvent[], clips: readonly ClipSpan[], avoid: readonly { at: number; duration: number }[] = []): number {
  return events.filter(
    (event) => isLeftClick(event) && clips.some((clip) => event.t >= clip.from && event.t < clip.to) && !avoid.some((other) => event.t >= other.at && event.t < other.at + other.duration),
  ).length;
}

/**
 * The zooms for a take's left clicks inside `clips`, in source seconds and pixels. `avoid` are the
 * zooms already there (the answer zoom, zooms made by hand): clicks under one are left to it, no
 * click zoom overlaps one, and they count for the 5 output seconds between zoom starts.
 */
export function clickZooms(events: readonly InputEvent[], clips: readonly ClipSpan[], screen: { width: number; height: number }, avoid: readonly { at: number; duration: number }[] = []): ClickZoom[] {
  const clipOf = (t: number) => clips.findIndex((clip) => t >= clip.from && t < clip.to);
  const outputAt = (t: number, index: number) => clips[index]!.start + (t - clips[index]!.from) / clips[index]!.speed;
  /** Output seconds where a zoom starts, when the video shows its source second. */
  const shownAt = (t: number) => {
    const index = clipOf(t);
    return index < 0 ? undefined : outputAt(t, index);
  };
  const under = (t: number) => avoid.some((other) => t >= other.at && t < other.at + other.duration);

  const clicks = events
    .filter(isLeftClick)
    .map((click) => ({ ...click, clip: clipOf(click.t) }))
    .filter((click) => click.clip >= 0 && clips[click.clip]!.speed <= MAX_SPEED && !under(click.t))
    .sort((a, b) => a.t - b.t);

  // clusters: close in time, within one clip, and in one part of the screen
  const clusters: (typeof clicks)[] = [];
  for (const click of clicks) {
    const open = clusters.at(-1);
    const last = open?.at(-1);
    if (open && last && last.clip === click.clip && (click.t - last.t) / clips[click.clip]!.speed <= CLUSTER_GAP_SECONDS && fits(boxOf([...open, click]), screen)) {
      open.push(click);
      continue;
    }
    clusters.push([click]);
  }

  // each cluster's zoom, timed in output seconds at its clip's speed, and over before a zoom there
  let zooms = clusters.flatMap((cluster) => {
    const clip = clips[cluster[0]!.clip]!;
    const s = clip.speed;
    const at = Math.max(cluster[0]!.t - LEAD_SECONDS * s, clip.from + EDGE_SECONDS * s);
    const next = Math.min(...avoid.filter((other) => other.at > cluster.at(-1)!.t).map((other) => other.at));
    const end = Math.min(Math.max(cluster.at(-1)!.t + TAIL_SECONDS * s, at + MIN_SECONDS * s), clip.to - EDGE_SECONDS * s, next);
    if ((end - at) / s < MIN_SECONDS - 1e-9) return [];
    return [{ at, end, clip: cluster[0]!.clip, points: cluster.map(({ x, y }) => ({ x, y })), clicks: cluster.length }];
  });

  // neighbours that show nearly the same spot become one, while their clicks fit one zoom's box
  const merged: typeof zooms = [];
  for (const zoom of zooms) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.clip === zoom.clip &&
      (zoom.at - previous.end) / clips[zoom.clip]!.speed <= MERGE_GAP_SECONDS &&
      fits(boxOf([...previous.points, ...zoom.points]), screen) &&
      overlap(zoomRectFor(boxOf(previous.points), screen), zoomRectFor(boxOf(zoom.points), screen)) >= MERGE_OVERLAP
    ) {
      previous.end = Math.max(previous.end, zoom.end);
      previous.points.push(...zoom.points);
      previous.clicks += zoom.clicks;
      continue;
    }
    merged.push({ ...zoom, points: [...zoom.points] });
  }
  // in the order people see them (scenes can be moved out of source order)
  zooms = merged.sort((a, b) => outputAt(a.at, a.clip) - outputAt(b.at, b.clip));

  // work that moves on soon after, elsewhere in the same clip: the zoom before moves along to it
  type Station = { at: number; points: { x: number; y: number }[] };
  const chains: ((typeof zooms)[number] & { stations: Station[] })[] = [];
  for (const zoom of zooms) {
    const previous = chains.at(-1);
    const s = clips[zoom.clip]!.speed;
    if (previous && previous.clip === zoom.clip && zoom.at > previous.at && (zoom.at - previous.end) / s <= FOLLOW_GAP_SECONDS) {
      const last = previous.stations.at(-1)!;
      previous.stations.push({ at: Math.max(zoom.at, last.at + 0.1 * s), points: zoom.points });
      previous.end = Math.max(previous.end, zoom.end);
      previous.clicks += zoom.clicks;
      continue;
    }
    chains.push({ ...zoom, stations: [{ at: zoom.at, points: zoom.points }] });
  }

  // where the zooms already there start, in output seconds
  const starts = avoid.map((other) => shownAt(other.at)).filter((t): t is number => t !== undefined);
  const result: ClickZoom[] = [];
  let lastEnd = -Infinity;
  for (const zoom of chains) {
    const rect = zoomRectFor(boxOf(zoom.stations[0]!.points), screen);
    if ((rect[2] * rect[3]) / (screen.width * screen.height) > MAX_AREA) continue;
    if (avoid.some((other) => zoom.at < other.at + other.duration && other.at < zoom.end)) continue;
    // one at a time, and not too often (the zooms already there count)
    const start = outputAt(zoom.at, zoom.clip);
    if (start < lastEnd || starts.some((other) => Math.abs(start - other) < MIN_OUTPUT_GAP)) continue;
    const moves = zoom.stations.slice(1).map((station) => ({ at: round(station.at), rect: zoomRectFor(boxOf(station.points), screen) }));
    result.push({ at: round(zoom.at), duration: round(zoom.end - zoom.at), rect, ...(moves.length > 0 && { moves }), clicks: zoom.clicks });
    starts.push(start);
    lastEnd = outputAt(zoom.end, zoom.clip);
  }
  return result;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
