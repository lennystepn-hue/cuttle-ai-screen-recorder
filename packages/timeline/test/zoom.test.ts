import { describe, expect, it } from 'vitest';
import type { Rect, Zoom } from '@cuttle/project';
import { zoomRectAt } from '../src/zoom';

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
});
