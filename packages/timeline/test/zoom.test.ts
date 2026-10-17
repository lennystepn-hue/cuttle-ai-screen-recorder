import { describe, expect, it } from 'vitest';
import type { Rect, Zoom } from '@cuttle/project';
import { fitZoomRect, zoomRectAt } from '../src/zoom';

const full: Rect = [0, 0, 2560, 1440];
const zoom = (at: number, duration: number, rect: Rect, extra: Partial<Zoom> = {}): Zoom => ({
  at, duration, rect, ease: 'smooth', enabled: true, ...extra,
});
const half: Rect = [0, 0, 1280, 720];
/** Every zoom fully in (between its ramps). */
const full1 = (): number => 1;

describe('zoomRectAt', () => {
  it('returns the full frame outside every zoom', () => {
    expect(zoomRectAt([zoom(12, 4, half)], 11, full1, full)).toEqual(full);
    expect(zoomRectAt([zoom(12, 4, half)], 16.5, full1, full)).toEqual(full);
  });

  it('holds the target rect between the ramps', () => {
    expect(zoomRectAt([zoom(12, 4, half)], 14, full1, full)).toEqual(half);
  });

  it('moves each zoom its amount of the way to its rect', () => {
    expect(zoomRectAt([zoom(12, 4, half)], 12.3, () => 0.5, full)).toEqual([0, 0, 1920, 1080]);
    expect(zoomRectAt([zoom(12, 4, half)], 12.3, () => 0, full)).toEqual(full);
  });

  it('ignores disabled zooms', () => {
    expect(zoomRectAt([zoom(12, 4, half, { enabled: false })], 14, full1, full)).toEqual(full);
  });

  it('lets the zoom with the later start win when zooms overlap', () => {
    const later: Rect = [100, 100, 640, 360];
    expect(zoomRectAt([zoom(12, 4, half), zoom(13, 2, later)], 14, full1, full)).toEqual(later);
  });

  it('is active for at <= t < at + duration (half-open end)', () => {
    const z = [zoom(12, 4, half)];
    expect(zoomRectAt(z, 11.999, full1, full)).toEqual(full);
    expect(zoomRectAt(z, 12, full1, full)).toEqual(half);
    expect(zoomRectAt(z, 16, full1, full)).toEqual(full);
  });

  it('eases a later zoom from the rect produced so far instead of from the full frame', () => {
    const inner: Rect = [0, 0, 640, 360];
    const zooms = [zoom(12, 4, half), zoom(13, 2, inner)];
    const amounts = new Map([[zooms[0]!, 1], [zooms[1]!, 0.5]]);
    expect(zoomRectAt(zooms, 14, (z) => amounts.get(z)!, full)).toEqual([0, 0, 960, 540]);
  });

  it('never returns the caller\'s full array', () => {
    const result = zoomRectAt([], 1, full1, full);
    expect(result).toEqual(full);
    expect(result).not.toBe(full);
  });

  it('aspect-fits the target rect of each zoom', () => {
    const tall: Rect = [1000, 500, 200, 400];
    const result = zoomRectAt([zoom(12, 4, tall)], 14, full1, full);
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
