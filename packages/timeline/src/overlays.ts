import type { ClipScene, Mask, Rect, TextOverlay } from '@cuttle/project';

/** Length of a text's fades in output seconds (see `rampAmount`). */
export const TEXT_FADE_SECONDS = 0.25;

export interface ActiveText {
  overlay: TextOverlay;
  opacity: number;
}

/**
 * Where a mask is at `sourceTime`: its places are its rect at `from`, then each move's. Between two
 * of them it covers both, safe however the text moved between the frames read; after the last it
 * holds that one.
 */
export function maskRectAt(mask: Pick<Mask, 'from' | 'rect' | 'moves'>, sourceTime: number): Rect {
  const places = [{ at: mask.from, rect: mask.rect }, ...(mask.moves ?? [])];
  let i = 0;
  while (i + 1 < places.length && places[i + 1]!.at <= sourceTime) i++;
  const here = places[i]!.rect;
  const next = places[i + 1]?.rect;
  if (!next) return here;
  const left = Math.min(here[0], next[0]);
  const top = Math.min(here[1], next[1]);
  return [left, top, Math.max(here[0] + here[2], next[0] + next[2]) - left, Math.max(here[1] + here[3], next[1] + next[3]) - top];
}

/** Enabled masks whose `[from, to)` range, in source seconds, contains `sourceTime`; one that follows, where it is then. */
export function activeMasks(masks: readonly Mask[], sourceTime: number): Mask[] {
  return masks
    .filter((mask) => mask.enabled && sourceTime >= mask.from && sourceTime < mask.to)
    .map((mask) => (mask.moves?.length ? { ...mask, rect: maskRectAt(mask, sourceTime) } : mask));
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
