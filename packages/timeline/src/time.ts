import type { ClipScene, Scene } from '@cuttle/project';
import { clamp } from './easing';

/** A scene's slot on the output timeline: `start` and `end` in output seconds, `start` inclusive, `end` exclusive. */
export interface SceneSpan {
  index: number;
  start: number;
  end: number;
  scene: Scene;
}

/** Rounds to whole microseconds so summed scene lengths land exactly on frame times. */
function snap(seconds: number): number {
  return Math.round(seconds * 1e6) / 1e6;
}

/** Length of a scene on the output timeline, in output seconds. */
export function sceneDuration(scene: Scene): number {
  return scene.type === 'clip' ? (scene.to - scene.from) / scene.speed : scene.duration;
}

/** Lays scenes end to end on the output timeline, in output seconds. */
export function sceneSpans(scenes: readonly Scene[]): SceneSpan[] {
  let start = 0;
  return scenes.map((scene, index) => {
    const end = snap(start + sceneDuration(scene));
    const span = { index, start, end, scene };
    start = end;
    return span;
  });
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
 * Whether the boundary from scene `a` to scene `b` is a continuous cut: two clips where the first
 * ends where the second begins (within 1 ms), as a split or a speed change makes. It has no
 * crossfade, no held frame and no audio fade; overlays run across it.
 */
export function isContinuousCut(a: Scene, b: Scene): boolean {
  return a.type === 'clip' && b.type === 'clip' && Math.abs(a.to - b.from) < CONTINUOUS_CUT_SECONDS;
}
