import type { ClipScene, Mask, TextOverlay } from '@cuttle/project';
import { clamp01 } from './easing';

/** Text fade length in output seconds; converted to source seconds with the scene speed. */
export const TEXT_FADE_SECONDS = 0.25;

export interface ActiveText {
  overlay: TextOverlay;
  opacity: number;
}

/** Enabled masks whose `[from, to)` range, in source seconds, contains `sourceTime`. */
export function activeMasks(masks: readonly Mask[], sourceTime: number): Mask[] {
  return masks.filter((mask) => mask.enabled && sourceTime >= mask.from && sourceTime < mask.to);
}

/** Enabled texts whose `[at, at+duration)` range, in source seconds, contains `sourceTime`; fade is 0.25 output seconds × `speed`, so opacity may be 0 on the first frame. */
export function activeTexts(texts: readonly TextOverlay[], sourceTime: number, speed: number): ActiveText[] {
  const active: ActiveText[] = [];
  for (const overlay of texts) {
    const end = overlay.at + overlay.duration;
    if (!overlay.enabled || sourceTime < overlay.at || sourceTime >= end) continue;
    const fade = Math.min(TEXT_FADE_SECONDS * speed, overlay.duration / 2);
    const opacity = Math.min(clamp01((sourceTime - overlay.at) / fade), clamp01((end - sourceTime) / fade));
    active.push({ overlay, opacity });
  }
  return active;
}

/** Badge text for a clip scene: an explicit badge wins, `''` hides it, otherwise "<speed>× speed" when the rounded speed is above 1. */
export function badgeFor(scene: ClipScene): string | undefined {
  if (scene.badge !== undefined) return scene.badge === '' ? undefined : scene.badge;
  const shown = Math.round(scene.speed * 10) / 10;
  return shown > 1 ? `${shown}× speed` : undefined;
}
