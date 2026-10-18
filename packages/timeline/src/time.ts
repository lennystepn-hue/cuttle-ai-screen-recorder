import type { ClipScene, Scene } from '@cuttle/project';
import { clamp } from './easing';

/**
 * A slot on the output timeline: `start` and `end` in output seconds, `start` inclusive, `end`
 * exclusive. A clip with cuts in it has one span per piece the cuts leave.
 */
export interface SceneSpan {
  /** Where the span is in the list of spans. */
  index: number;
  /** The scene it shows, in the project's `scenes`. */
  sceneIndex: number;
  start: number;
  end: number;
  /** The scene; for a clip with cuts, the piece of it (a copy with its own `from` and `to`). */
  scene: Scene;
  /** A cut lies right before this piece of a clip: a jump with no crossfade, overlays run on across it. */
  cutBefore?: boolean;
}

/** A source range taken out of the clips that cover it (`cuts` in the project). */
export interface CutRange {
  from: number;
  to: number;
  enabled?: boolean;
}

/** A piece shorter than this (output seconds, under a frame at 50 fps) is dropped. */
export const MIN_PIECE_SECONDS = 0.02;

/** Rounds to whole microseconds so summed scene lengths land exactly on frame times. */
function snap(seconds: number): number {
  return Math.round(seconds * 1e6) / 1e6;
}

/** Length of a scene on the output timeline, in output seconds. */
export function sceneDuration(scene: Scene): number {
  return scene.type === 'clip' ? (scene.to - scene.from) / scene.speed : scene.duration;
}

/** The pieces of a clip its enabled cuts leave, in order; the clip itself when no cut touches it. */
export function clipPieces(clip: ClipScene, cuts: readonly CutRange[]): ClipScene[] {
  const ranges = cuts
    .filter((cut) => cut.enabled !== false && cut.to > clip.from && cut.from < clip.to)
    .map((cut) => [Math.max(cut.from, clip.from), Math.min(cut.to, clip.to)] as const)
    .sort((a, b) => a[0] - b[0]);
  if (ranges.length === 0) return [clip];
  const pieces: ClipScene[] = [];
  let at = clip.from;
  for (const [from, to] of ranges) {
    if (from > at) pieces.push({ ...clip, from: at, to: from });
    at = Math.max(at, to);
  }
  if (clip.to > at) pieces.push({ ...clip, from: at, to: clip.to });
  return pieces.filter((piece) => (piece.to - piece.from) / piece.speed >= MIN_PIECE_SECONDS);
}

/** Lays scenes end to end on the output timeline, in output seconds; clips lose what `cuts` take out. */
export function sceneSpans(scenes: readonly Scene[], cuts: readonly CutRange[] = []): SceneSpan[] {
  let start = 0;
  const spans: SceneSpan[] = [];
  scenes.forEach((scene, sceneIndex) => {
    const pieces = scene.type === 'clip' ? clipPieces(scene, cuts) : [scene];
    pieces.forEach((piece, n) => {
      const end = snap(start + sceneDuration(piece));
      spans.push({ index: spans.length, sceneIndex, start, end, scene: piece, ...(n > 0 && { cutBefore: true }) });
      start = end;
    });
  });
  return spans;
}

/** Total length of the output timeline in output seconds; 0 without scenes. */
export function totalDuration(spans: readonly SceneSpan[]): number {
  return spans.at(-1)?.end ?? 0;
}

/** The span containing output time `t` (output seconds); clamps to the first/last span, `undefined` without spans. */
export function spanAt(spans: readonly SceneSpan[], t: number): SceneSpan | undefined {
  for (const span of spans) {
    if (t < span.end) return span;
  }
  return spans.at(-1);
}

/** Maps scene-local output seconds to source seconds, clamped to the clip's `[from, to]`. */
export function sourceTimeAt(scene: ClipScene, local: number): number {
  return clamp(scene.from + local * scene.speed, scene.from, scene.to);
}

/** Two clips closer than this (source seconds) at a boundary count as one continuous piece of footage. */
export const CONTINUOUS_CUT_SECONDS = 1e-3;

/**
 * Half the crossfade between neighbouring spans `a` and `b`, in output seconds: half the look's
 * transition, but at most half of either span; none at a continuous cut, at a cut (`cuts`), or
 * with transitions off. A scene with a transition page of its own (`b.scene.transition`) is gone
 * into with that page, as long as it says, also with the look's crossfades off.
 * The picture and the export's sound share it.
 */
export function crossfadeHalf(a: SceneSpan, b: SceneSpan, transition: { enabled: boolean; duration: number }): number {
  if (b.cutBefore || isContinuousCut(a.scene, b.scene)) return 0;
  const own = b.scene.transition?.enabled ? b.scene.transition : undefined;
  if (!own && !transition.enabled) return 0;
  return Math.min((own ?? transition).duration / 2, (a.end - a.start) / 2, (b.end - b.start) / 2);
}

/** Whether the way from span `a` into span `b` is the page of `b`'s transition (not a crossfade). */
export function pageTransition(a: SceneSpan, b: SceneSpan, transition: { enabled: boolean; duration: number }): boolean {
  return b.scene.transition?.enabled === true && crossfadeHalf(a, b, transition) > 0;
}

/**
 * Whether the boundary from scene `a` to scene `b` is a continuous cut: two clips where the first
 * ends where the second begins (within 1 ms), as a split or a speed change makes. It has no
 * crossfade, no held frame and no audio fade; overlays run across it.
 */
export function isContinuousCut(a: Scene, b: Scene): boolean {
  return a.type === 'clip' && b.type === 'clip' && Math.abs(a.to - b.from) < CONTINUOUS_CUT_SECONDS;
}
