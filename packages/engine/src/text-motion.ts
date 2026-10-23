// How a caption looks while it comes in and goes out (`enter`, `exit`): its opacity, its scale
// around its middle, how far below its place it is, how blurred, how much of its text shows
// (`reveal`, letters), how much of its box (`sweep`). Its place stays its whole text's.
import type { TextAnimation } from '@cuttle/project';
import { easeInOutCubic } from '@cuttle/timeline';

export interface TextMotion {
  opacity: number;
  scale: number;
  /** Output px below its place. */
  dy: number;
  /** Blur radius, output px. */
  blur: number;
  /** The letters shown, from the start (none: all of them). */
  reveal?: number;
  /** The share of its box shown, from the left (none: all of it). */
  sweep?: number;
}

/** How far a caption slides, and how blurred it starts, in units. */
export const TEXT_MOTION = { slide: 32, blur: 14 } as const;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOutCubic = (x: number) => 1 - (1 - clamp01(x)) ** 3;
const easeInCubic = (x: number) => clamp01(x) ** 3;
/** Past its end and back, as a thing that pops into place. */
const easeOutBack = (x: number) => {
  const t = clamp01(x);
  return 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
};

/** The letters before the `count` first words of `text` (a word with the spaces after it). */
function lettersOfWords(text: string, count: number): number {
  const letters = [...text];
  let words = 0;
  for (let i = 0; i < letters.length; i++) {
    if (/\s/.test(letters[i]!) && i > 0 && !/\s/.test(letters[i - 1]!)) {
      words++;
      if (words >= count) return i;
    }
  }
  return count > 0 && words < count ? letters.length : 0;
}

/**
 * The caption's look with `enter` coming in `progress.enter` of the way and `exit` going out
 * `progress.exit` of the way (both linear in output time; eased here). A caption that fades both
 * ways takes the timeline's own fade (`fade`), when there is one.
 */
export function textMotion(enter: TextAnimation, exit: TextAnimation, progress: { enter: number; exit: number; fade?: number }, text: string, unit: number): TextMotion {
  if (enter === 'fade' && exit === 'fade' && progress.fade !== undefined) return { opacity: progress.fade, scale: 1, dy: 0, blur: 0 };
  const motion: TextMotion = { opacity: 1, scale: 1, dy: 0, blur: 0 };
  const letters = [...text].length;
  const words = text.split(/\s+/).filter(Boolean).length;
  const reveal = (shown: number) => (motion.reveal = Math.min(motion.reveal ?? letters, shown));
  const sweep = (shown: number) => (motion.sweep = Math.min(motion.sweep ?? 1, shown));
  if (progress.enter < 1) {
    const p = clamp01(progress.enter);
    switch (enter) {
      case 'fade':
        motion.opacity *= p;
        break;
      case 'pop':
        motion.scale *= 0.6 + 0.4 * easeOutBack(p);
        motion.opacity *= clamp01(p * 4);
        break;
      case 'slide':
        motion.dy += (1 - easeOutCubic(p)) * TEXT_MOTION.slide * unit;
        motion.opacity *= clamp01(p * 2);
        break;
      case 'blur':
        motion.blur = Math.max(motion.blur, (1 - easeOutCubic(p)) * TEXT_MOTION.blur * unit);
        motion.opacity *= clamp01(p * 2);
        break;
      case 'typewriter':
        reveal(Math.floor(letters * p));
        break;
      case 'words':
        reveal(lettersOfWords(text, Math.floor(words * p)));
        break;
      case 'sweep':
        sweep(easeInOutCubic(p));
        break;
    }
  }
  if (progress.exit > 0) {
    const q = clamp01(progress.exit);
    switch (exit) {
      case 'fade':
        motion.opacity *= 1 - q;
        break;
      case 'pop':
        motion.scale *= 1 - 0.2 * easeInCubic(q);
        motion.opacity *= 1 - q;
        break;
      case 'slide':
        motion.dy += easeInCubic(q) * TEXT_MOTION.slide * unit;
        motion.opacity *= 1 - q;
        break;
      case 'blur':
        motion.blur = Math.max(motion.blur, easeInCubic(q) * TEXT_MOTION.blur * unit);
        motion.opacity *= 1 - q;
        break;
      case 'typewriter':
        reveal(Math.ceil(letters * (1 - q)));
        break;
      case 'words':
        reveal(lettersOfWords(text, Math.ceil(words * (1 - q))));
        break;
      case 'sweep':
        sweep(1 - easeInOutCubic(q));
        break;
    }
  }
  return motion;
}
