import { describe, expect, it } from 'vitest';
import { displayOf, eventWallTime, pixelMapper } from '../src/darwin';

// A 1440×900 point Retina display (2880×1800 pixels) with a 1920×1080 display at 1× to its right,
// and one at 2× above it.
const retina = { id: 1, points: { x: 0, y: 0, width: 1440, height: 900 }, scale: 2 };
const external = { id: 2, points: { x: 1440, y: 100, width: 1920, height: 1080 }, scale: 1 };
const above = { id: 3, points: { x: 0, y: -1080, width: 1920, height: 1080 }, scale: 2 };

describe('pixelMapper', () => {
  it('maps points on a Retina display to its backing pixels', () => {
    const map = pixelMapper([retina]);
    expect(map.origin(retina)).toEqual({ x: 0, y: 0 });
    expect(map.toPixels(720.5, 450.25)).toEqual({ x: 1441, y: 901 });
  });

  it('places every display at its point origin times the largest scale, so none overlaps another', () => {
    const map = pixelMapper([retina, external, above]);
    expect(map.origin(external)).toEqual({ x: 2880, y: 200 });
    expect(map.origin(above)).toEqual({ x: 0, y: -2160 });
    // a point on the 1× display moves one pixel per point there, starting at its origin
    expect(map.toPixels(1440 + 10, 100 + 20)).toEqual({ x: 2890, y: 220 });
    // the Retina display's last point stays left of the external display's first pixel
    expect(map.toPixels(1439, 10).x).toBeLessThan(2880);
  });

  it('maps a point off every display onto the nearest one', () => {
    expect(pixelMapper([retina]).toPixels(-5, 10)).toEqual({ x: -10, y: 20 });
  });
});

describe('displayOf', () => {
  it('finds the display that holds most of a window', () => {
    expect(displayOf([retina, external], { x: 1300, y: 200, width: 400, height: 300 })).toBe(external);
    expect(displayOf([retina, external], { x: 1000, y: 200, width: 400, height: 300 })).toBe(retina);
    expect(displayOf([retina], { x: 5000, y: 5000, width: 10, height: 10 })).toBeUndefined();
  });
});

describe('eventWallTime', () => {
  // an M1's mach ticks: 125/3 ns each
  const ticks = { numer: 125n, denom: 3n };
  const now = { wall: 1_000_000, uptimeNs: 500_000_000_000n, machNs: 500_000_000_000n };

  it('reads a timestamp in nanoseconds of the uptime clock', () => {
    expect(eventWallTime(now.uptimeNs - 40_000_000n, now, ticks)).toBeCloseTo(now.wall - 0.04, 6);
  });

  it('reads a timestamp in mach ticks', () => {
    const stamp = ((now.machNs - 150_000_000n) * ticks.denom) / ticks.numer;
    expect(eventWallTime(stamp, now, ticks)).toBeCloseTo(now.wall - 0.15, 4);
  });

  it('takes the wall clock for an event without a timestamp or one that fits neither clock', () => {
    expect(eventWallTime(0n, now, ticks)).toBe(now.wall);
    expect(eventWallTime(now.uptimeNs + 1_000_000_000n, now, ticks)).toBe(now.wall);
  });
});
