import { describe, expect, it } from 'vitest';
import type { ClipScene, Mask, TextOverlay } from '@cuttle/project';
import { activeMasks, activeTexts, badgeFor } from '../src/overlays';

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
});

describe('activeTexts', () => {
  it('fades in and out over 0.25 output seconds', () => {
    expect(activeTexts([text], 11.125, 1)).toEqual([{ overlay: text, opacity: 0.5 }]);
    expect(activeTexts([text], 12, 1)).toEqual([{ overlay: text, opacity: 1 }]);
    expect(activeTexts([text], 12.9, 1)[0]?.opacity).toBeCloseTo(0.4, 6);
  });

  it('hides texts outside their range and disabled texts', () => {
    expect(activeTexts([text], 10.9, 1)).toEqual([]);
    expect(activeTexts([text], 13, 1)).toEqual([]);
    expect(activeTexts([{ ...text, enabled: false }], 12, 1)).toEqual([]);
  });

  it('stretches the fade with speed, capped at half the duration', () => {
    // speed 12 → fade min(3, 1) = 1 source second
    expect(activeTexts([text], 11.5, 12)).toEqual([{ overlay: text, opacity: 0.5 }]);
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
