import type { ClipScene, Scene } from '@cuttle/project';
import { clamp } from './easing';

export interface SceneSpan {
  index: number;
  start: number;
  end: number;
  scene: Scene;
}

export function sceneDuration(scene: Scene): number {
  return scene.type === 'clip' ? (scene.to - scene.from) / scene.speed : scene.duration;
}

export function sceneSpans(scenes: readonly Scene[]): SceneSpan[] {
  let start = 0;
  return scenes.map((scene, index) => {
    const end = start + sceneDuration(scene);
    const span = { index, start, end, scene };
    start = end;
    return span;
  });
}

export function totalDuration(spans: readonly SceneSpan[]): number {
  return spans.at(-1)?.end ?? 0;
}

export function spanAt(spans: readonly SceneSpan[], t: number): SceneSpan | undefined {
  for (const span of spans) {
    if (t < span.end) return span;
  }
  return spans.at(-1);
}

export function sourceTimeAt(scene: ClipScene, local: number): number {
  return scene.from + clamp(local, 0, sceneDuration(scene)) * scene.speed;
}
