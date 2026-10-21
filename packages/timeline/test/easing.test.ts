import { describe, expect, it } from 'vitest';
import { clamp, ease, easeInOutCubic, lerp, lerpRect, settle } from '../src/easing';

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

describe('settle', () => {
  const speed = (x: number) => (settle(x + 1e-6) - settle(x - 1e-6)) / 2e-6;

  it('starts at 0, ends at 1 and only ever rises', () => {
    expect([settle(-1), settle(0), settle(1), settle(2)]).toEqual([0, 0, 1, 1]);
    for (let x = 0.001; x <= 1; x += 0.001) expect(settle(x)).toBeGreaterThan(settle(x - 0.001));
  });

  it('sets off at once and settles slowly: past half the way a quarter of the time in', () => {
    expect(settle(0.25)).toBeGreaterThan(0.5);
    expect(settle(2 / 3)).toBeGreaterThan(0.95);
    // fastest a seventh of the time in, as the spring it follows
    const fastest = Array.from({ length: 999 }, (_, i) => (i + 1) / 1000).reduce((best, x) => (speed(x) > speed(best) ? x : best));
    expect(fastest).toBeCloseTo(1 / 7, 2);
  });

  it('starts and arrives with no speed', () => {
    expect(speed(1e-6)).toBeLessThan(0.001);
    expect(speed(1 - 1e-6)).toBeLessThan(0.001);
  });
});

describe('ease', () => {
  it('uses the cubic curve for smooth, a clamped line for linear and the spring for settle', () => {
    expect(ease('smooth', 0.25)).toBe(0.0625);
    expect(ease('linear', 0.3)).toBe(0.3);
    expect(ease('linear', 1.5)).toBe(1);
    expect(ease('settle', 0.4)).toBe(settle(0.4));
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
