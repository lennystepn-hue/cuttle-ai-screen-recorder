import type { ClipScene, Mask, Rect, TextAnimation, TextOverlay } from '@cuttle/project';
import { clamp } from './easing';

/** Length of a text's fades in output seconds (see `rampAmount`). */
export const TEXT_FADE_SECONDS = 0.25;

export interface ActiveText {
  overlay: TextOverlay;
  /** Its fades: what a caption that fades in and out (the default) shows with. */
  opacity: number;
  /** How far it has come in (0 to 1 over its `enter`, 1 once in), and gone out (0 until its `exit` starts), in output time. */
  enter: number;
  exit: number;
}

/**
 * How long a caption takes to come in, or to go out (`out`), with each animation (output seconds): a
 * fade a quarter second, the others a little longer; a typewriter or word by word longer for a
 * longer text (going out quicker), within bounds.
 */
export function textAnimationSeconds(animation: TextAnimation, text: string, out = false): number {
  switch (animation) {
    case 'fade':
      return TEXT_FADE_SECONDS;
    case 'pop':
      return 0.35;
    case 'slide':
    case 'blur':
      return 0.4;
    case 'sweep':
      return 0.45;
    case 'typewriter':
      return clamp([...text].length * (out ? 0.02 : 0.045), 0.3, out ? 0.6 : 1.6);
    case 'words':
      return clamp(text.split(/\s+/).filter(Boolean).length * (out ? 0.06 : 0.16), 0.3, out ? 0.6 : 1.6);
  }
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
export function activeTexts(texts: readonly TextOverlay[], sourceTime: number, motionOf: (text: TextOverlay) => Omit<ActiveText, 'overlay'>): ActiveText[] {
  const active: ActiveText[] = [];
  for (const overlay of texts) {
    if (!overlay.enabled || sourceTime < overlay.at || sourceTime >= overlay.at + overlay.duration) continue;
    active.push({ overlay, ...motionOf(overlay) });
  }
  return active;
}

/** Badge text for a clip scene: an explicit badge wins, `''` hides it, otherwise "<speed>× speed" when the rounded speed is above 1. */
export function badgeFor(scene: ClipScene): string | undefined {
  if (scene.badge !== undefined) return scene.badge === '' ? undefined : scene.badge;
  const shown = Math.round(scene.speed * 10) / 10;
  return shown > 1 ? `${shown}× speed` : undefined;
}
