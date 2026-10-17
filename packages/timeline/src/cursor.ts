import type { CursorShape, InputEvent } from '@cuttle/project';
import { clamp01, lerp } from './easing';

/** Click effect length in output seconds; converted to source seconds with the scene speed. */
export const CLICK_EFFECT_SECONDS = 0.4;

/** The smoothed path's samples per source second. */
export const SMOOTH_RATE = 120;
/** No move for this long is a rest: the cursor holds still, it is not smoothed across. */
export const REST_SECONDS = 0.25;
/**
 * A step at least this far, and this many times faster than the steps on either side of it, is a
 * jump (a program moved the pointer, or it crossed displays): not smoothed across. A hand's flick
 * speeds up and slows down, so its fastest steps have fast neighbours; a jump comes out of nowhere.
 */
export const JUMP_PX = 200;
export const JUMP_RATIO = 4;
/** Below this speed (px/s) a neighbouring step counts as still. */
const STILL_SPEED = 300;
/** Smoothed paths kept per track (a few smoothings tried in the Look tab). */
const KEPT_PATHS = 4;

type Point = { t: number; x: number; y: number };

export interface CursorTrack {
  moves: Point[];
  clicks: { t: number; x: number; y: number; button: 'left' | 'right' | 'middle' }[];
  shapes: { t: number; shape: CursorShape }[];
  /** Smoothed paths made so far, by smoothing and cuts (made on first use; the last few are kept). */
  smoothed?: Map<string, Point[]>;
}

export interface CursorFrame {
  x: number;
  y: number;
  shape: CursorShape;
  clicks: { x: number; y: number; progress: number }[];
}

export function createCursorTrack(events: readonly InputEvent[]): CursorTrack {
  const track: CursorTrack = { moves: [], clicks: [], shapes: [] };
  // a click after the moves of the same moment: the cursor's last place at that time is the click's
  for (const event of [...events].sort((a, b) => a.t - b.t || Number(a.type === 'click') - Number(b.type === 'click'))) {
    if (event.type === 'move') {
      track.moves.push({ t: event.t, x: event.x, y: event.y });
    } else if (event.type === 'click') {
      track.moves.push({ t: event.t, x: event.x, y: event.y });
      track.clicks.push({ t: event.t, x: event.x, y: event.y, button: event.button });
    } else if (event.type === 'shape') {
      track.shapes.push({ t: event.t, shape: event.shape });
    }
  }
  return track;
}

/** The Gaussian's sigma in source seconds for a smoothing of 0–1 (0.5: 0.1 s). */
export const smoothingSigma = (smoothing: number) => 0.02 + 0.16 * smoothing;

/** The step into sample `i`: its length and its speed (px/s). */
function step(moves: readonly Point[], i: number): { distance: number; speed: number } | undefined {
  if (i <= 0 || i >= moves.length) return undefined;
  const a = moves[i - 1]!;
  const b = moves[i]!;
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  return { distance, speed: distance / Math.max(b.t - a.t, 0.001) };
}

/** Whether the step into sample `i` is a jump (see `JUMP_PX`). */
export function isJump(moves: readonly Point[], i: number): boolean {
  const here = step(moves, i);
  if (!here || here.distance < JUMP_PX) return false;
  const around = Math.max(STILL_SPEED, step(moves, i - 1)?.speed ?? 0, step(moves, i + 1)?.speed ?? 0);
  return here.speed >= JUMP_RATIO * around;
}

/**
 * The indexes of `moves` where the path is cut into stretches that are smoothed on their own: the
 * first and last sample, every click (it must be exact), both sides of a rest (the cursor holds
 * still), of a jump (a teleport is not smoothed across) and of a cut (`pinned`: the video jumps
 * there, so neither side may borrow from the other).
 */
export function anchorsOf(moves: readonly Point[], clicks: readonly { t: number }[], pinned: ReadonlySet<number> = new Set()): number[] {
  const anchors = new Set<number>([0, moves.length - 1, ...pinned]);
  const clickTimes = new Set(clicks.map((click) => click.t));
  for (let i = 0; i < moves.length; i++) {
    if (clickTimes.has(moves[i]!.t)) anchors.add(i);
    if (i === 0) continue;
    if (moves[i]!.t - moves[i - 1]!.t >= REST_SECONDS || isJump(moves, i)) {
      anchors.add(i - 1);
      anchors.add(i);
    }
  }
  return [...anchors].sort((a, b) => a - b);
}

/** The moves with a sample of the recorded path at each cut inside them; and those samples' indexes. */
function withCuts(moves: readonly Point[], cuts: readonly number[]): { moves: Point[]; pinned: Set<number> } {
  const inside = [...new Set(cuts)].filter((t) => t > moves[0]!.t && t < moves.at(-1)!.t).sort((a, b) => a - b);
  if (inside.length === 0) return { moves: [...moves], pinned: new Set() };
  const out: Point[] = [];
  const pinned = new Set<number>();
  let next = 0;
  for (let i = 0; i < moves.length; i++) {
    const point = moves[i]!;
    while (next < inside.length && inside[next]! <= point.t) {
      const t = inside[next++]!;
      if (t === point.t) {
        pinned.add(out.length);
        continue;
      }
      const previous = moves[i - 1]!;
      const f = (t - previous.t) / (point.t - previous.t);
      pinned.add(out.length);
      out.push({ t, x: lerp(previous.x, point.x, f), y: lerp(previous.y, point.y, f) });
    }
    out.push(point);
  }
  return { moves: out, pinned };
}

/** The path between two samples, resampled at `SMOOTH_RATE` (its ends are the samples themselves). */
function resample(moves: readonly Point[], from: number, to: number): Point[] {
  const start = moves[from]!;
  const end = moves[to]!;
  const count = Math.max(2, Math.round((end.t - start.t) * SMOOTH_RATE) + 1);
  const points: Point[] = [];
  let k = from;
  for (let i = 0; i < count; i++) {
    const t = i === count - 1 ? end.t : start.t + ((end.t - start.t) * i) / (count - 1);
    while (k < to - 1 && moves[k + 1]!.t <= t) k++;
    const a = moves[k]!;
    const b = moves[Math.min(k + 1, to)]!;
    const f = b.t === a.t ? 0 : clamp01((t - a.t) / (b.t - a.t));
    points.push({ t, x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) });
  }
  return points;
}

/**
 * One stretch smoothed: a centred Gaussian (no lag), its window cut at the stretch's ends, then the
 * ends' errors faded out near them, so it starts and ends exactly at its anchors.
 */
function smoothStretch(points: Point[], sigma: number): Point[] {
  const n = points.length;
  if (n <= 2) return points;
  const radius = Math.ceil(3 * sigma * SMOOTH_RATE);
  const weights = Array.from({ length: radius + 1 }, (_, d) => Math.exp(-((d / SMOOTH_RATE) ** 2) / (2 * sigma * sigma)));
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    let x = 0;
    let y = 0;
    let total = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(n - 1, i + radius); j++) {
      const w = weights[Math.abs(j - i)]!;
      x += points[j]!.x * w;
      y += points[j]!.y * w;
      total += w;
    }
    out.push({ t: points[i]!.t, x: x / total, y: y / total });
  }
  // The ends' errors fade out within the kernel's reach (or the stretch, when it is shorter): an
  // anchor's own jitter bends the path near it only, not the whole stretch.
  const first = { x: points[0]!.x - out[0]!.x, y: points[0]!.y - out[0]!.y };
  const last = { x: points[n - 1]!.x - out[n - 1]!.x, y: points[n - 1]!.y - out[n - 1]!.y };
  const reach = Math.min(radius, n - 1);
  const fade = (distance: number) => {
    const u = clamp01(1 - distance / reach);
    return u * u * (3 - 2 * u);
  };
  return out.map((point, i) => {
    const a = fade(i);
    const b = fade(n - 1 - i);
    return { t: point.t, x: point.x + first.x * a + last.x * b, y: point.y + first.y * a + last.y * b };
  });
}

/**
 * The path the cursor draws at `smoothing` (0: as recorded), with the source seconds where the
 * video cuts (`cuts`) kept apart. Made once per track, smoothing and cuts; the last few are kept.
 */
export function smoothedPath(track: CursorTrack, smoothing: number, cuts: readonly number[] = []): Point[] {
  if (smoothing <= 0 || track.moves.length < 3) return track.moves;
  track.smoothed ??= new Map();
  const key = `${smoothing}|${cuts.join(',')}`;
  const known = track.smoothed.get(key);
  if (known) return known;
  const sigma = smoothingSigma(Math.min(1, smoothing));
  const { moves, pinned } = withCuts(track.moves, cuts);
  const anchors = anchorsOf(moves, track.clicks, pinned);
  const path: Point[] = [];
  for (let k = 0; k + 1 < anchors.length; k++) {
    const from = anchors[k]!;
    const to = anchors[k + 1]!;
    const a = moves[from]!;
    const b = moves[to]!;
    // Between two anchors next to each other the cursor holds still until the next sample, then is
    // there: a rest (no move logged) or a jump. A cut's anchor next to a sample is a plain step.
    const holds = b.t - a.t >= REST_SECONDS || isJump(moves, to);
    const stretch = to - from > 1 ? smoothStretch(resample(moves, from, to), sigma) : holds && b.t - a.t > 1 / SMOOTH_RATE ? [a, { t: b.t - 1 / SMOOTH_RATE, x: a.x, y: a.y }, b] : [a, b];
    // one by one: a long stretch has too many points for a spread
    for (let i = path.length > 0 ? 1 : 0; i < stretch.length; i++) path.push(stretch[i]!);
  }
  if (track.smoothed.size >= KEPT_PATHS) track.smoothed.delete(track.smoothed.keys().next().value!);
  track.smoothed.set(key, path);
  return path;
}

function positionAt(moves: readonly Point[], t: number): { x: number; y: number } {
  const first = moves[0]!;
  const last = moves[moves.length - 1]!;
  if (t <= first.t) return { x: first.x, y: first.y };
  if (t >= last.t) return { x: last.x, y: last.y };
  // Invariant: moves[lo].t <= t < moves[hi].t
  let lo = 0;
  let hi = moves.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (moves[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = moves[lo]!;
  const b = moves[hi]!;
  const f = (t - a.t) / (b.t - a.t);
  return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) };
}

/**
 * The cursor at a source time: on the path smoothed by `smoothing` (0, the default: as recorded),
 * kept apart at `cuts` (source seconds where the video jumps).
 */
export function cursorAt(track: CursorTrack, sourceTime: number, speed: number, smoothing = 0, cuts: readonly number[] = []): CursorFrame | undefined {
  if (track.moves.length === 0) return undefined;
  const { x, y } = positionAt(smoothedPath(track, smoothing, cuts), sourceTime);

  let shape: CursorShape = 'arrow';
  for (const change of track.shapes) {
    if (change.t > sourceTime) break;
    shape = change.shape;
  }

  const effectLength = CLICK_EFFECT_SECONDS * speed;
  const clicks = track.clicks
    .filter((click) => sourceTime >= click.t && sourceTime < click.t + effectLength)
    .map((click) => ({ x: click.x, y: click.y, progress: clamp01((sourceTime - click.t) / effectLength) }));

  return { x, y, shape, clicks };
}
