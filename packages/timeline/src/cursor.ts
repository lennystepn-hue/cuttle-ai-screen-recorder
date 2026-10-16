import type { CursorShape, InputEvent } from '@cuttle/project';
import { clamp01, lerp } from './easing';

/** Click effect length in output seconds; converted to source seconds with the scene speed. */
export const CLICK_EFFECT_SECONDS = 0.4;

export interface CursorTrack {
  moves: { t: number; x: number; y: number }[];
  clicks: { t: number; x: number; y: number; button: 'left' | 'right' | 'middle' }[];
  shapes: { t: number; shape: CursorShape }[];
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

function positionAt(moves: CursorTrack['moves'], t: number): { x: number; y: number } {
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

export function cursorAt(track: CursorTrack, sourceTime: number, speed: number): CursorFrame | undefined {
  if (track.moves.length === 0) return undefined;
  const { x, y } = positionAt(track.moves, sourceTime);

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
