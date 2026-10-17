import { describe, expect, it } from 'vitest';
import type { Rect, Zoom } from '@cuttle/project';
import { fitZoomRect, zoomRectAt, zoomTargetAt } from '../src/zoom';

const full: Rect = [0, 0, 2560, 1440];
const zoom = (at: number, duration: number, rect: Rect, extra: Partial<Zoom> = {}): Zoom => ({
  at, duration, rect, ease: 'smooth', enabled: true, ...extra,
});
const half: Rect = [0, 0, 1280, 720];
/** A rect to 6 decimals (halfway along a move is not exact). */
const near = (rect: Rect) => rect.map((value) => expect.closeTo(value, 6));
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

  it('follows a zoom along its moves', () => {
    const right: Rect = [1280, 0, 1280, 720];
    const following = zoom(12, 6, half, { moves: [{ at: 14, rect: right }] });
    expect(zoomRectAt([following], 13, full1, full)).toEqual(half);
    expect(zoomRectAt([following], 14, full1, full)).toEqual(near([640, 0, 1280, 720]));
    expect(zoomRectAt([following], 15, full1, full)).toEqual(right);
    // at 8× the move takes 8 times as many source seconds (4.8): halfway at the move, not there a second later
    expect(zoomRectAt([following], 14, full1, full, 8)).toEqual(near([640, 0, 1280, 720]));
    expect(zoomRectAt([following], 15, full1, full, 8)[0]).toBeCloseTo(1152.96, 1);
  });
});

describe('zoomTargetAt', () => {
  const a: Rect = [0, 0, 800, 450];
  const b: Rect = [400, 0, 800, 450];
  const c: Rect = [400, 300, 800, 450];

  it('eases from one rect to the next over 0.6 s centred on each move', () => {
    const path = { rect: a, moves: [{ at: 2, rect: b }, { at: 4, rect: c }] };
    expect(zoomTargetAt(path, 1.7)).toEqual(a);
    // a quarter of the time in, the smooth curve is 1/16 of the way: 25 of 400 px
    expect(zoomTargetAt(path, 1.85)[0]).toBeCloseTo(25, 6);
    expect(zoomTargetAt(path, 2)).toEqual(near([200, 0, 800, 450]));
    expect(zoomTargetAt(path, 2.3)).toEqual(b);
    expect(zoomTargetAt(path, 3.7)).toEqual(b);
    expect(zoomTargetAt(path, 4.3)).toEqual(c);
    expect(zoomTargetAt({ rect: a }, 3)).toBe(a);
  });

  it('blends moves closer than 0.6 s without a jump', () => {
    const path = { rect: a, moves: [{ at: 2, rect: b }, { at: 2.2, rect: c }] };
    let previous = zoomTargetAt(path, 1.6);
    for (let t = 1.6; t <= 2.6; t += 0.01) {
      const now = zoomTargetAt(path, t);
      expect(Math.abs(now[0] - previous[0]) + Math.abs(now[1] - previous[1])).toBeLessThan(25);
      previous = now;
    }
    expect(previous).toEqual(c);
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
