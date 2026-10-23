import { describe, expect, it } from 'vitest';
import type { ClipScene, Mask, TextOverlay } from '@cuttle/project';
import { TEXT_FADE_SECONDS, activeMasks, activeTexts, badgeFor, maskRectAt, textAnimationSeconds } from '../src/overlays';

const mask = (from: number, to: number, enabled = true): Mask => ({
  from, to, rect: [0, 0, 50, 50], style: 'fill', enabled,
});
const text: TextOverlay = { at: 11, duration: 2, text: 'Hi', style: 'pill', position: 'top', enabled: true };
const clip = (speed: number, badge?: string): ClipScene =>
  badge === undefined ? { type: 'clip', from: 0, to: 10, speed } : { type: 'clip', from: 0, to: 10, speed, badge };

describe('activeMasks', () => {
  const masks = [mask(0, 15), mask(5, 6, false)];
  it('returns enabled masks whose range contains t, end exclusive', () => {
    expect(activeMasks(masks, 0)).toEqual([masks[0]]);
    expect(activeMasks(masks, 5.5)).toEqual([masks[0]]);
    expect(activeMasks(masks, 15)).toEqual([]);
  });

  it('follows text that scrolls: between two places it covers both, after the last it holds it', () => {
    // seen at y 100 until 4 s, at y 60 at 4.5 s, and at y 20 from 6 s on
    const scrolling: Mask = { ...mask(1, 10), rect: [10, 100, 200, 20], moves: [{ at: 4, rect: [10, 100, 200, 20] }, { at: 4.5, rect: [10, 60, 200, 20] }, { at: 6, rect: [10, 20, 200, 20] }] };
    expect(maskRectAt(scrolling, 2)).toEqual([10, 100, 200, 20]);
    expect(maskRectAt(scrolling, 4.2)).toEqual([10, 60, 200, 60]);
    expect(maskRectAt(scrolling, 5)).toEqual([10, 20, 200, 60]);
    expect(maskRectAt(scrolling, 8)).toEqual([10, 20, 200, 20]);
    expect(activeMasks([scrolling], 4.2)[0]!.rect).toEqual([10, 60, 200, 60]);
  });
});

describe('activeTexts', () => {
  const shown = { opacity: 1, enter: 1, exit: 0 };

  it('gives each active text its opacity and how far it has come in and gone out', () => {
    expect(activeTexts([text], 12, () => ({ opacity: 0.4, enter: 0.5, exit: 0 }))).toEqual([{ overlay: text, opacity: 0.4, enter: 0.5, exit: 0 }]);
  });

  it('hides texts outside their range and disabled texts', () => {
    expect(activeTexts([text], 10.9, () => shown)).toEqual([]);
    expect(activeTexts([text], 13, () => shown)).toEqual([]);
    expect(activeTexts([{ ...text, enabled: false }], 12, () => shown)).toEqual([]);
  });
});

describe('badgeFor', () => {
  it('shows an automatic badge only for sped-up clips', () => {
    expect(badgeFor(clip(1))).toBeUndefined();
    expect(badgeFor(clip(12))).toBe('12× speed');
    expect(badgeFor(clip(1.5))).toBe('1.5× speed');
  });

  it('rounds the speed once and hides the badge when it rounds to 1', () => {
    expect(badgeFor(clip(1.04))).toBeUndefined();
    expect(badgeFor(clip(1.25))).toBe('1.3× speed');
  });

  it('uses an explicit badge and hides it when empty', () => {
    expect(badgeFor(clip(12, 'fast-forward'))).toBe('fast-forward');
    expect(badgeFor(clip(12, ''))).toBeUndefined();
  });
});

describe('textAnimationSeconds', () => {
  it('takes a quarter second to fade, longer to type a longer text, and goes out quicker', () => {
    expect(textAnimationSeconds('fade', 'Hello')).toBe(TEXT_FADE_SECONDS);
    expect(textAnimationSeconds('typewriter', 'Hi')).toBe(0.3);
    expect(textAnimationSeconds('typewriter', 'A longer line of text')).toBeGreaterThan(0.9);
    expect(textAnimationSeconds('typewriter', 'A longer line of text', true)).toBeLessThan(textAnimationSeconds('typewriter', 'A longer line of text'));
    expect(textAnimationSeconds('words', 'one two three four five six seven eight nine ten eleven twelve')).toBe(1.6);
  });
});
