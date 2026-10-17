import type { ClipScene, Mask, TextOverlay } from '@cuttle/project';

/** Length of a text's fades in output seconds (see `rampAmount`). */
export const TEXT_FADE_SECONDS = 0.25;

export interface ActiveText {
  overlay: TextOverlay;
  opacity: number;
}

/** Enabled masks whose `[from, to)` range, in source seconds, contains `sourceTime`. */
export function activeMasks(masks: readonly Mask[], sourceTime: number): Mask[] {
  return masks.filter((mask) => mask.enabled && sourceTime >= mask.from && sourceTime < mask.to);
}

/** Enabled texts whose `[at, at+duration)` range, in source seconds, contains `sourceTime`, with their opacity from `opacityOf` (their fades; 0 on a fade's first frame). */
export function activeTexts(texts: readonly TextOverlay[], sourceTime: number, opacityOf: (text: TextOverlay) => number): ActiveText[] {
  const active: ActiveText[] = [];
  for (const overlay of texts) {
    if (!overlay.enabled || sourceTime < overlay.at || sourceTime >= overlay.at + overlay.duration) continue;
    active.push({ overlay, opacity: opacityOf(overlay) });
  }
  return active;
}

/** Badge text for a clip scene: an explicit badge wins, `''` hides it, otherwise "<speed>× speed" when the rounded speed is above 1. */
export function badgeFor(scene: ClipScene): string | undefined {
  if (scene.badge !== undefined) return scene.badge === '' ? undefined : scene.badge;
  const shown = Math.round(scene.speed * 10) / 10;
  return shown > 1 ? `${shown}× speed` : undefined;
}
