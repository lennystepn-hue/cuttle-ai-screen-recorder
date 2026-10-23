import { describe, expect, it } from 'vitest';
import type { Rect, Zoom } from '@cuttle/project';
import { settle } from '../src/easing';
import { ZOOM_MOVE_LEAD, ZOOM_MOVE_SECONDS, fitZoomRect, zoomBetween, zoomRectAt, zoomTargetAt } from '../src/zoom';

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

  it('moves each zoom its amount of the way to its rect, on the even scale', () => {
    // halfway to 2×: √2×
    expect(zoomRectAt([zoom(12, 4, half)], 12.3, () => 0.5, full)).toEqual(near([0, 0, 2560 / Math.SQRT2, 1440 / Math.SQRT2]));
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
    expect(zoomRectAt(zooms, 14, (z) => amounts.get(z)!, full)).toEqual(near([0, 0, 1280 / Math.SQRT2, 720 / Math.SQRT2]));
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
    // three quarters there at the move's time, there 0.5 s after it
    const atMove = 1280 * settle(ZOOM_MOVE_LEAD / ZOOM_MOVE_SECONDS);
    expect(zoomRectAt([following], 14, full1, full)).toEqual(near([atMove, 0, 1280, 720]));
    expect(zoomRectAt([following], 14.5, full1, full)).toEqual(right);
    // at 8× the move takes 8 times as many source seconds (6.4): as far at the move, not there 0.5 s later
    expect(zoomRectAt([following], 14, full1, full, 8)).toEqual(near([atMove, 0, 1280, 720]));
    expect(zoomRectAt([following], 14.5, full1, full, 8)[0]).toBeCloseTo(1280 * settle((2.4 + 0.5) / 6.4), 6);
  });
});

describe('zoomTargetAt', () => {
  const a: Rect = [0, 0, 800, 450];
  const b: Rect = [400, 0, 800, 450];
  const c: Rect = [400, 300, 800, 450];

  it('settles from one rect to the next over 0.8 s, from 0.3 s before each move', () => {
    const path = { rect: a, moves: [{ at: 2, rect: b }, { at: 4, rect: c }] };
    expect(zoomTargetAt(path, 1.7)).toEqual(a);
    // a quarter of the time in, the settling curve is past half of the way (it sets off at once)
    expect(zoomTargetAt(path, 1.9)[0]).toBeCloseTo(400 * settle(0.25), 6);
    expect(settle(0.25)).toBeGreaterThan(0.5);
    expect(zoomTargetAt(path, 2.5)).toEqual(b);
    expect(zoomTargetAt(path, 3.7)).toEqual(b);
    expect(zoomTargetAt(path, 4.5)).toEqual(c);
    expect(zoomTargetAt({ rect: a }, 3)).toBe(a);
  });

  it('takes each move on its own curve: in and out, at an even pace, or a jump at its time', () => {
    const at = (curve: 'smooth' | 'linear' | 'jump', t: number) => zoomTargetAt({ rect: a, moves: [{ at: 2, rect: b, ease: curve }] }, t)[0];
    // the same 0.8 s from 0.3 s before the move: halfway through, half the way (in and out), and a quarter in a quarter of the way
    expect(at('smooth', 2.1)).toBeCloseTo(200, 6);
    expect(at('smooth', 1.9)).toBeLessThan(400 * 0.25);
    expect(at('linear', 1.9)).toBeCloseTo(100, 6);
    expect(at('linear', 2.5)).toBe(400);
    // a jump: where it was until its time, then there
    expect(at('jump', 1.99)).toBe(0);
    expect(at('jump', 2)).toBe(400);
    // and on from where a jump left it
    expect(zoomTargetAt({ rect: a, moves: [{ at: 2, rect: b, ease: 'jump' }, { at: 3, rect: c }] }, 4)).toEqual(c);
  });

  it('blends moves that overlap without a jump or a stop, and arrives at the last', () => {
    const path = { rect: a, moves: [{ at: 2, rect: b }, { at: 2.2, rect: c }] };
    const step = 1 / 120;
    const at = (t: number) => zoomTargetAt(path, t);
    let previous = at(1.6);
    let speed = 0;
    for (let t = 1.6 + step; t <= 3.2; t += step) {
      const now = at(t);
      const next = Math.hypot(now[0] - previous[0], now[1] - previous[1]) / step;
      // the speed changes by no more than a spring's pull on the whole way allows (no jump: a stop
      // from the top speed, 1300 px/s, would be five times that), and never drops to nothing
      // between the two moves (no stop) until the second has arrived
      expect(Math.abs(next - speed), `at ${t.toFixed(3)} s`).toBeLessThan((7 / ZOOM_MOVE_SECONDS) ** 2 * 500 * step);
      // (the first runs from 1.7 to 2.5 s, the second from 1.9 to 2.7 s)
      if (t > 1.75 && t < 2.5) expect(next, `at ${t.toFixed(3)} s`).toBeGreaterThan(50);
      speed = next;
      previous = now;
    }
    expect(previous).toEqual(c);
  });
});

describe('zoomBetween', () => {
  it('goes from one view to the other, the same rects at the ends', () => {
    expect(zoomBetween(full, half, 0)).toEqual(full);
    expect(zoomBetween(full, half, 1)).toEqual(half);
    expect(zoomBetween(full, half, 1)).not.toBe(half);
  });

  it('zooms evenly: the size changes by the same factor in each step', () => {
    const sizes = [0, 0.25, 0.5, 0.75, 1].map((t) => zoomBetween(full, [640, 360, 640, 360], t)[2]);
    for (let i = 1; i < sizes.length - 1; i++) expect(sizes[i]! / sizes[i - 1]!).toBeCloseTo(sizes[i + 1]! / sizes[i]!, 9);
  });

  it('keeps the point both views show at the same place where it is', () => {
    // 2× on the right half's middle: the point at three quarters across stays three quarters across
    const target: Rect = [1280, 360, 1280, 720];
    for (const t of [0.2, 0.5, 0.8]) {
      const [x, y, width, height] = zoomBetween(full, target, t);
      expect((2560 - x) / width).toBeCloseTo(1, 9);
      expect((720 - y) / height).toBeCloseTo(0.5, 9);
    }
  });

  it('pans evenly between views of one size', () => {
    expect(zoomBetween(half, [1280, 720, 1280, 720], 0.25)).toEqual(near([320, 180, 1280, 720]));
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
