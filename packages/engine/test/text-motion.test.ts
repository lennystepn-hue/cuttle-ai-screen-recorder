import { describe, expect, it } from 'vitest';
import { TEXT_MOTION, textMotion } from '../src/text-motion';

const at = (enter: number, exit = 0) => ({ enter, exit });

describe('textMotion', () => {
  it('takes the timeline’s own fade when a caption fades both ways', () => {
    expect(textMotion('fade', 'fade', { ...at(0.5), fade: 0.3 }, 'Hello', 1)).toEqual({ opacity: 0.3, scale: 1, dy: 0, blur: 0 });
    // a card has none: it fades by its progress
    expect(textMotion('fade', 'fade', at(0.5), 'Hello', 1).opacity).toBeCloseTo(0.5);
  });

  it('comes in each way, and is itself once in', () => {
    expect(textMotion('pop', 'fade', at(0), 'Hi', 1).scale).toBeCloseTo(0.6);
    // past its size on the way, then at it
    expect(Math.max(...[0.6, 0.7, 0.8, 0.9].map((p) => textMotion('pop', 'fade', at(p), 'Hi', 1).scale))).toBeGreaterThan(1);
    expect(textMotion('slide', 'fade', at(0), 'Hi', 2).dy).toBe(TEXT_MOTION.slide * 2);
    expect(textMotion('blur', 'fade', at(0), 'Hi', 1).blur).toBe(TEXT_MOTION.blur);
    expect(textMotion('typewriter', 'fade', at(0.5), 'Typed text', 1).reveal).toBe(5);
    // word by word: whole words, the space after a word with it
    expect(textMotion('words', 'fade', at(0.5), 'one two three four', 1).reveal).toBe(7);
    expect(textMotion('sweep', 'fade', at(0.5), 'Hi', 1).sweep).toBeCloseTo(0.5);
    for (const enter of ['pop', 'slide', 'blur', 'typewriter', 'words', 'sweep'] as const) {
      const shown = textMotion(enter, 'pop', at(1), 'All of it', 1);
      expect(shown, enter).toMatchObject({ opacity: 1, scale: 1, dy: 0, blur: 0 });
      expect(shown.reveal ?? 9, enter).toBe(9);
      expect(shown.sweep ?? 1, enter).toBe(1);
    }
  });

  it('goes out each way, a typewriter deleting its letters', () => {
    expect(textMotion('fade', 'pop', at(1, 1), 'Hi', 1)).toMatchObject({ opacity: 0, scale: 0.8 });
    expect(textMotion('fade', 'slide', at(1, 1), 'Hi', 1).dy).toBe(TEXT_MOTION.slide);
    expect(textMotion('fade', 'typewriter', at(1, 0.5), 'Typed text', 1).reveal).toBe(5);
    expect(textMotion('fade', 'sweep', at(1, 1), 'Hi', 1).sweep).toBe(0);
  });
});
