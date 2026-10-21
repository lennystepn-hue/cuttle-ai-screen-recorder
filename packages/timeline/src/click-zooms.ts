// Zooms that follow the clicks of a take: clicks close in time and place make one zoom that eases
// in as the first click happens, stays while the work goes on there, and leaves. When the work moves
// on soon after, elsewhere, the zoom moves along to it (`moves`) instead of leaving the clicks there
// outside the view: it follows the pointer, setting off as it does, and holds still while the
// pointer stays well in view. Fewer, better zooms: never in
// waiting that is sped up, never one that would barely zoom, never two at once, and at most one
// starting in any 5 output seconds (counting the zooms that are there). Times are as people see
// them: output seconds, turned into source seconds at the clip's speed. Pure; `suggest` and the
// editor share it.
import type { InputEvent, Rect } from '@cuttle/project';
import { ZOOM_MOVE_LEAD, ZOOM_RAMP_SECONDS } from './zoom';

/** A click joins the zoom being formed when it comes this soon after its last click (output s)… */
export const CLUSTER_GAP_SECONDS = 3;
/** …and the clicks' box with it stays within this share of the screen's width and height. */
export const CLUSTER_SPAN = 0.4;
/** Room around the clicks, as a share of the screen's width. */
export const PAD = 0.1;
/** A zoom shows at least this share of the screen's width (at most about 2.2× zoom)… */
export const MIN_WIDTH = 0.45;
/**
 * …and on a display that says its scale, at least this many of its points across (its pixels over
 * its scale): as much of the interface as MIN_WIDTH shows of a 1920-pixel screen at 100 %, so a
 * Retina Mac (1440 points across) or a laptop at 150 % is not zoomed deeper than that…
 */
export const MIN_POINTS = 860;
/**
 * …but never less deep than this: a window taken on a Retina display is often narrower than
 * MIN_POINTS allows to zoom, and a zoom of 1.1 or 1.3× looks like the picture slipping.
 */
export const MIN_DEPTH = 1.5;

/** The screen a zoom is made for: its size in pixels, and its pixels per point when the take says so. */
export interface ZoomScreen {
  width: number;
  height: number;
  scale?: number;
}

/**
 * The narrowest view a zoom may have (px): `share` of the screen's width, and on a display with a
 * scale at least as many points as MIN_POINTS is to MIN_WIDTH; never wider than MIN_DEPTH allows.
 */
export function minZoomWidth(screen: ZoomScreen, share = MIN_WIDTH): number {
  const points = screen.scale ? ((MIN_POINTS * share) / MIN_WIDTH) * screen.scale : 0;
  return Math.min(screen.width / MIN_DEPTH, Math.max(share * screen.width, points));
}
/** A zoom that would show more than this share of the screen's area barely zooms: none. */
export const MAX_AREA = 0.8;
/** The zoom starts this long before the first click (it is in by then: `ZOOM_RAMP_SECONDS`; output s)… */
export const LEAD_SECONDS = 0.7;
/**
 * …and lasts until this long after the last one, at least `MIN_SECONDS` (output s): over a
 * second fully in after the click before it leaves, in 0.8 s.
 */
export const TAIL_SECONDS = 2;
export const MIN_SECONDS = 2.4;
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
 * followed by it: it moves there, before the first of them, instead of a zoom of their own (which
 * `MIN_OUTPUT_GAP` would not allow). With `LEAD_SECONDS` and `TAIL_SECONDS` it leaves no click
 * between following and a zoom of its own: clicks up to 5.1 s apart are followed.
 */
export const FOLLOW_GAP_SECONDS = 2.4;
/**
 * A zoom follows the pointer once it leaves the middle of the view (this share of it each way) for
 * a place where it rests or clicks, and only by at least `MIN_MOVE` of the view (against the
 * screen's edge it cannot go further): where the pointer stays well in view, it holds still.
 */
export const FOLLOW_MIDDLE = 0.7;
export const MIN_MOVE = 0.05;
/** The pointer rests where it stays this long within `REST_RADIUS` of the view's width (output s); an outing that comes back before is no reason to move. */
export const REST_SECONDS = 0.4;
export const REST_RADIUS = 0.1;
/**
 * The view sets off this long before the pointer leaves the middle (output s): with it, not as it
 * drifts about inside (the view would leave it behind)…
 */
export const FOLLOW_LEAD = 0.15;
/** …and at the latest so that it is there (95 %) by the click it goes to (output s). */
export const ARRIVE_SECONDS = 0.55;
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

/** A box padded, made at least `minZoomWidth` wide in the screen's aspect, and kept on the screen. */
export function zoomRectFor(box: Box, screen: ZoomScreen): Rect {
  const pad = PAD * screen.width;
  const aspect = screen.width / screen.height;
  let width = Math.max(box.right - box.left + 2 * pad, minZoomWidth(screen));
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
export function clickZooms(events: readonly InputEvent[], clips: readonly ClipSpan[], screen: ZoomScreen, avoid: readonly { at: number; duration: number }[] = []): ClickZoom[] {
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
    return [{ at, end, clip: cluster[0]!.clip, first: cluster[0]!.t, points: cluster.map(({ x, y }) => ({ x, y })), clicks: cluster.length }];
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
  type Station = { at: number; first: number; points: { x: number; y: number }[] };
  const chains: ((typeof zooms)[number] & { stations: Station[] })[] = [];
  for (const zoom of zooms) {
    const previous = chains.at(-1);
    const s = clips[zoom.clip]!.speed;
    if (previous && previous.clip === zoom.clip && zoom.at > previous.at && (zoom.at - previous.end) / s <= FOLLOW_GAP_SECONDS) {
      const last = previous.stations.at(-1)!;
      previous.stations.push({ at: Math.max(zoom.at, last.at + 0.1 * s), first: zoom.first, points: zoom.points });
      previous.end = Math.max(previous.end, zoom.end);
      previous.clicks += zoom.clicks;
      continue;
    }
    chains.push({ ...zoom, stations: [{ at: zoom.at, first: zoom.first, points: zoom.points }] });
  }

  // where the pointer is, for the zooms to follow it: its moves and clicks
  const pointer: Sample[] = events
    .flatMap((event) => (event.type === 'move' || event.type === 'click' ? [{ t: event.t, x: event.x, y: event.y, click: isLeftClick(event) }] : []))
    .sort((a, b) => a.t - b.t || Number(a.click) - Number(b.click));

  // where the zooms already there start, in output seconds
  const starts = avoid.map((other) => shownAt(other.at)).filter((t): t is number => t !== undefined);
  const result: ClickZoom[] = [];
  let lastEnd = -Infinity;
  for (const zoom of chains) {
    const s = clips[zoom.clip]!.speed;
    // a chain that cannot start where it does (another zoom starts near it, or is still on) starts at
    // a later station: its first clicks go without, the work after them is still followed
    for (let first = 0; first < zoom.stations.length; first++) {
      const stations = zoom.stations.slice(first);
      const at = stations[0]!.at;
      if ((zoom.end - at) / s < MIN_SECONDS - 1e-9) break;
      const rect = zoomRectFor(boxOf(stations[0]!.points), screen);
      if ((rect[2] * rect[3]) / (screen.width * screen.height) > MAX_AREA) continue;
      if (avoid.some((other) => at < other.at + other.duration && other.at < zoom.end)) continue;
      // one at a time, and not too often (the zooms already there count)
      const start = outputAt(at, zoom.clip);
      if (start < lastEnd || starts.some((other) => Math.abs(start - other) < MIN_OUTPUT_GAP)) continue;
      const moves = followMoves({ rect, from: stations[0]!.first, to: zoom.end, speed: s }, pointer, screen);
      result.push({ at: round(at), duration: round(zoom.end - at), rect, ...(moves.length > 0 && { moves }), clicks: stations.reduce((sum, station) => sum + station.points.length, 0) });
      starts.push(start);
      lastEnd = outputAt(zoom.end, zoom.clip);
      break;
    }
  }
  return result;
}

type Sample = { t: number; x: number; y: number; click: boolean };

/**
 * Where a zoom that shows `rect` from its first click (`from`) to its end (`to`, source seconds at
 * the clip's `speed`) moves as the pointer goes on: whenever the pointer leaves the middle of the
 * view (`FOLLOW_MIDDLE`) for a place where it rests or clicks, the view goes there, centred on it
 * the way it left (across, up or down, or both), setting off `FOLLOW_LEAD` before the pointer left
 * and there by its click (`ARRIVE_SECONDS`).
 */
function followMoves(zoom: { rect: Rect; from: number; to: number; speed: number }, pointer: readonly Sample[], screen: ZoomScreen): { at: number; rect: Rect }[] {
  const { from, to, speed } = zoom;
  const moves: { at: number; rect: Rect }[] = [];
  let view = zoom.rect;
  // outside the middle across, and up or down
  const outX = (point: Sample) => Math.abs(point.x - (view[0] + view[2] / 2)) > (FOLLOW_MIDDLE / 2) * view[2];
  const outY = (point: Sample) => Math.abs(point.y - (view[1] + view[3] / 2)) > (FOLLOW_MIDDLE / 2) * view[3];
  const middle = (point: Sample) => !outX(point) && !outY(point);
  // a move sets off after the one before did, and none once the zoom is about to leave
  let earliest = from;
  const last = to - ZOOM_RAMP_SECONDS * speed;
  for (let k = pointer.findIndex((sample) => sample.t >= from); k >= 0 && k < pointer.length && pointer[k]!.t < last; k++) {
    if (middle(pointer[k]!)) continue;
    const j = restOf(pointer, k, speed, REST_RADIUS * view[2]);
    const there = pointer[j]!;
    if (there.t >= to) break;
    // centred on it along the way it left the middle (the other way holds still); none for an
    // outing that comes back into the middle, or a place the view cannot go nearer to
    const [, , width, height] = view;
    const next: Rect = [
      outX(there) ? Math.round(Math.min(Math.max(there.x - width / 2, 0), screen.width - width)) : view[0],
      outY(there) ? Math.round(Math.min(Math.max(there.y - height / 2, 0), screen.height - height)) : view[1],
      width,
      height,
    ];
    if (middle(there) || (Math.abs(next[0] - view[0]) < MIN_MOVE * width && Math.abs(next[1] - view[1]) < MIN_MOVE * height)) {
      k = j;
      continue;
    }
    // set off as the pointer leaves the middle for that place (after it was last there on its way),
    // and be there by the click it goes to
    let leaves = j;
    while (leaves > k && !middle(pointer[leaves - 1]!)) leaves--;
    let start = pointer[leaves]!.t - FOLLOW_LEAD * speed;
    if (there.click) start = Math.min(start, there.t - ARRIVE_SECONDS * speed);
    start = Math.max(start, earliest);
    moves.push({ at: round(start + ZOOM_MOVE_LEAD * speed), rect: next });
    earliest = start + 0.05 * speed;
    view = next;
    k = j;
  }
  return moves;
}

/**
 * Where the pointer comes to rest from sample `k` on: the first click, or the first time it stays
 * within `radius` for `REST_SECONDS` (the last sample of that stay: where it settled); the last
 * sample when it never does.
 */
function restOf(pointer: readonly Sample[], k: number, speed: number, radius: number): number {
  for (let j = k; j < pointer.length; j++) {
    if (pointer[j]!.click) return j;
    const here = pointer[j]!;
    let settled = j;
    for (let i = j + 1; i < pointer.length && pointer[i]!.t < here.t + REST_SECONDS * speed; i++) {
      if (pointer[i]!.click || Math.hypot(pointer[i]!.x - here.x, pointer[i]!.y - here.y) > radius) {
        settled = -1;
        break;
      }
      settled = i;
    }
    if (settled >= 0) return settled;
  }
  return pointer.length - 1;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
