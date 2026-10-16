import type { ClipScene, Mask, TextOverlay } from '@cuttle/project';
import { clamp01 } from './easing';

/** Text fade length in output seconds; converted to source seconds with the scene speed. */
export const TEXT_FADE_SECONDS = 0.25;

export interface ActiveText {
  overlay: TextOverlay;
  opacity: number;
}

export function activeMasks(masks: readonly Mask[], sourceTime: number): Mask[] {
  return masks.filter((mask) => mask.enabled && sourceTime >= mask.from && sourceTime < mask.to);
}

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

function formatSpeed(speed: number): string {
  return Number.isInteger(speed) ? String(speed) : String(Math.round(speed * 10) / 10);
}

export function badgeFor(scene: ClipScene): string | undefined {
  if (scene.badge !== undefined) return scene.badge === '' ? undefined : scene.badge;
  return scene.speed > 1 ? `${formatSpeed(scene.speed)}× speed` : undefined;
}
