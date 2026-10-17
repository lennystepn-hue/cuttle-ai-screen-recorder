import type { CursorShape, InputEvent } from '@cuttle/project';
import { clamp01, lerp } from './easing';

/** Click effect length in output seconds; converted to source seconds with the scene speed. */
export const CLICK_EFFECT_SECONDS = 0.4;

/** The smoothed path's samples per source second. */
export const SMOOTH_RATE = 120;
/** No move for this long is a rest: the cursor holds still, it is not smoothed across. */
export const REST_SECONDS = 0.25;
/** A move this far within one sample (at most `JUMP_SECONDS`) is a jump, not smoothed across. */
export const JUMP_PX = 400;
export const JUMP_SECONDS = 0.02;

type Point = { t: number; x: number; y: number };

export interface CursorTrack {
  moves: Point[];
  clicks: { t: number; x: number; y: number; button: 'left' | 'right' | 'middle' }[];
  shapes: { t: number; shape: CursorShape }[];
  /** Smoothed paths made so far, by smoothing (made on first use, kept for the track's life). */
  smoothed?: Map<number, Point[]>;
}

export interface CursorFrame {
  x: number;
  y: number;
  shape: CursorShape;
  clicks: { x: number; y: number; progress: number }[];
}

export function createCursorTrack(events: readonly InputEvent[]): CursorTrack {
  const track: CursorTrack = { moves: [], clicks: [], shapes: [] };
  for (const event of [...events].sort((a, b) => a.t - b.t)) {
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

/**
 * The indexes of `moves` where the path is cut into stretches that are smoothed on their own: the
 * first and last sample, every click (it must be exact), both sides of a rest (the cursor holds
 * still) and of a jump (a teleport is not smoothed across).
 */
export function anchorsOf(moves: readonly Point[], clicks: readonly { t: number }[]): number[] {
  const anchors = new Set<number>([0, moves.length - 1]);
  const clickTimes = new Set(clicks.map((click) => click.t));
  for (let i = 0; i < moves.length; i++) {
    if (clickTimes.has(moves[i]!.t)) anchors.add(i);
    if (i === 0) continue;
    const a = moves[i - 1]!;
    const b = moves[i]!;
    const rest = b.t - a.t >= REST_SECONDS;
    const jump = b.t - a.t <= JUMP_SECONDS && Math.hypot(b.x - a.x, b.y - a.y) >= JUMP_PX;
    if (rest || jump) {
      anchors.add(i - 1);
      anchors.add(i);
    }
  }
  return [...anchors].sort((a, b) => a - b);
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

/** The path the cursor draws at `smoothing` (0: as recorded), made once per track and smoothing. */
export function smoothedPath(track: CursorTrack, smoothing: number): Point[] {
  if (smoothing <= 0 || track.moves.length < 3) return track.moves;
  track.smoothed ??= new Map();
  const known = track.smoothed.get(smoothing);
  if (known) return known;
  const sigma = smoothingSigma(Math.min(1, smoothing));
  const anchors = anchorsOf(track.moves, track.clicks);
  const path: Point[] = [];
  for (let k = 0; k + 1 < anchors.length; k++) {
    const from = anchors[k]!;
    const to = anchors[k + 1]!;
    const a = track.moves[from]!;
    const b = track.moves[to]!;
    // between two anchors next to each other: a rest holds still until the next move, a jump jumps
    const stretch =
      to - from > 1 ? smoothStretch(resample(track.moves, from, to), sigma) : b.t - a.t >= REST_SECONDS ? [a, { t: b.t - 1 / SMOOTH_RATE, x: a.x, y: a.y }, b] : [a, b];
    path.push(...(path.length > 0 ? stretch.slice(1) : stretch));
  }
  track.smoothed.set(smoothing, path);
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

/** The cursor at a source time: on the path smoothed by `smoothing` (0, the default: as recorded). */
export function cursorAt(track: CursorTrack, sourceTime: number, speed: number, smoothing = 0): CursorFrame | undefined {
  if (track.moves.length === 0) return undefined;
  const { x, y } = positionAt(smoothedPath(track, smoothing), sourceTime);

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
