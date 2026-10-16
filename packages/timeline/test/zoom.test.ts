import { describe, expect, it } from 'vitest';
import type { Rect, Zoom } from '@cuttle/project';
import { fitZoomRect, zoomRectAt } from '../src/zoom';

const full: Rect = [0, 0, 2560, 1440];
const zoom = (at: number, duration: number, rect: Rect, extra: Partial<Zoom> = {}): Zoom => ({
  at, duration, rect, ease: 'smooth', enabled: true, ...extra,
});
const half: Rect = [0, 0, 1280, 720];

describe('zoomRectAt', () => {
  it('returns the full frame outside every zoom', () => {
    expect(zoomRectAt([zoom(12, 4, half)], 11, 1, full)).toEqual(full);
    expect(zoomRectAt([zoom(12, 4, half)], 16.5, 1, full)).toEqual(full);
  });

  it('holds the target rect between the ramps', () => {
    expect(zoomRectAt([zoom(12, 4, half)], 14, 1, full)).toEqual(half);
  });

  it('eases in and out over 0.6 output seconds', () => {
    // 12.3 - 12 is not exact in floating point, so compare with a tolerance
    const easingIn = zoomRectAt([zoom(12, 4, half)], 12.3, 1, full);
    expect(easingIn[2]).toBeCloseTo(1920, 6);
    expect(easingIn[3]).toBeCloseTo(1080, 6);
    expect(zoomRectAt([zoom(12, 4, half)], 15.7, 1, full)[2]).toBeCloseTo(1920, 6);
  });

  it('stretches the ramp with speed but never beyond half the zoom', () => {
    // speed 12 → ramp min(7.2, 2) = 2 source seconds; 1 s in is the middle of the ramp
    expect(zoomRectAt([zoom(12, 4, half)], 13, 12, full)).toEqual([0, 0, 1920, 1080]);
  });

  it('supports a linear ease', () => {
    expect(zoomRectAt([zoom(12, 4, half, { ease: 'linear' })], 12.15, 1, full)[2]).toBeCloseTo(2240, 6);
  });

  it('ignores disabled zooms', () => {
    expect(zoomRectAt([zoom(12, 4, half, { enabled: false })], 14, 1, full)).toEqual(full);
  });

  it('lets the zoom with the later start win when zooms overlap', () => {
    const later: Rect = [100, 100, 640, 360];
    expect(zoomRectAt([zoom(12, 4, half), zoom(13, 2, later)], 14, 1, full)).toEqual(later);
  });

  it('is active for at <= t < at + duration (half-open end)', () => {
    const z = [zoom(12, 4, half)];
    expect(zoomRectAt(z, 12, 1, full)).toEqual(full);
    expect(zoomRectAt(z, 16, 1, full)).toEqual(full);
    const atRampEnd = zoomRectAt(z, 12.6, 1, full);
    half.forEach((value, i) => expect(atRampEnd[i]).toBeCloseTo(value, 6));
  });

  it('eases a later zoom from the rect produced so far instead of from the full frame', () => {
    const inner: Rect = [0, 0, 640, 360];
    const zooms = [zoom(12, 4, half), zoom(13, 2, inner)];
    const widthAt = (t: number): number => zoomRectAt(zooms, t, 1, full)[2];
    // 0.001 s apart: the rect may drift a little but must not jump
    const neighbours: [number, number][] = [[12.999, 13], [13, 13.001], [14.999, 15], [15, 15.001]];
    for (const [a, b] of neighbours) {
      expect(Math.abs(widthAt(b) - widthAt(a))).toBeLessThanOrEqual(20);
    }
    expect(widthAt(13.3)).toBeGreaterThan(widthAt(14));
    expect(widthAt(13)).toBeCloseTo(1280, 6);
    expect(widthAt(14)).toBeCloseTo(640, 6);
  });

  it('never returns the caller\'s full array', () => {
    const result = zoomRectAt([], 1, 1, full);
    expect(result).toEqual(full);
    expect(result).not.toBe(full);
  });

  it('aspect-fits the target rect of each zoom', () => {
    const tall: Rect = [1000, 500, 200, 400];
    const result = zoomRectAt([zoom(12, 4, tall)], 14, 1, full);
    expect(result[2] / result[3]).toBeCloseTo(16 / 9, 6);
  });
});

describe('fitZoomRect', () => {
  const expectRect = (actual: Rect, expected: Rect): void => {
    expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 6));
  };

  it('keeps a rect that already has the aspect of the frame', () => {
    expect(fitZoomRect(half, full)).toEqual(half);
  });

  it('grows a tall rect around its centre to the frame aspect', () => {
    expectRect(fitZoomRect([1000, 500, 200, 400], full), [744.4444444, 500, 711.1111111, 400]);
  });

  it('shifts a rect hanging off the frame edge back inside', () => {
    expectRect(fitZoomRect([2400, 100, 640, 360], full), [1920, 100, 640, 360]);
  });

  it('turns an oversized rect into the full frame', () => {
    expectRect(fitZoomRect([-100, -100, 4000, 1000], full), full);
  });
});
