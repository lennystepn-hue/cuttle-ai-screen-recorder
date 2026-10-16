import { describe, expect, it } from 'vitest';
import { clamp, ease, easeInOutCubic, lerp, lerpRect } from '../src/easing';

describe('easeInOutCubic', () => {
  it('starts at 0, ends at 1 and is symmetric around the middle', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(0.25)).toBe(0.0625);
    expect(easeInOutCubic(0.75)).toBe(0.9375);
  });

  it('clamps input outside 0..1', () => {
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });
});

describe('ease', () => {
  it('uses the cubic curve for smooth and a clamped line for linear', () => {
    expect(ease('smooth', 0.25)).toBe(0.0625);
    expect(ease('linear', 0.3)).toBe(0.3);
    expect(ease('linear', 1.5)).toBe(1);
  });
});

describe('clamp, lerp, lerpRect', () => {
  it('clamps, interpolates numbers and rects', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(lerpRect([0, 0, 100, 100], [50, 50, 10, 10], 0.5)).toEqual([25, 25, 55, 55]);
  });
});
