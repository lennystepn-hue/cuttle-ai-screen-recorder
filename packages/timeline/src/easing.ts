import type { Ease, Rect } from '@cuttle/project';

export type EaseKind = Ease;
/** An ease, or `settle`: the camera's curve (zooms and their moves). */
export type Curve = EaseKind | 'settle';

/** How far a settling spring gets in its curve's time: `1 - (1 + u)e^-u` at `u` = this (99.3 % there). */
const SETTLE_RATE = 7;
/** The spring's way still to go at the curve's end, and its speed then (per curve length). */
const SETTLE_LEFT = (1 + SETTLE_RATE) * Math.exp(-SETTLE_RATE);
const SETTLE_SPEED = SETTLE_RATE * SETTLE_RATE * Math.exp(-SETTLE_RATE);

export function clamp(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x;
}

export function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

export function easeInOutCubic(x: number): number {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * The way a camera moves, as a critically damped spring pulled to its target: it sets off at once,
 * is fastest a seventh of its time in, then settles slowly (a quarter of the time covers half the
 * way, two thirds 96 %). Bent by a few thousandths so that it arrives at 1 with no speed left.
 */
export function settle(x: number): number {
  if (!(x > 0)) return 0;
  if (x >= 1) return 1;
  const u = SETTLE_RATE * x;
  return 1 - (1 + u) * Math.exp(-u) + (3 * SETTLE_LEFT + SETTLE_SPEED) * x * x - (2 * SETTLE_LEFT + SETTLE_SPEED) * x * x * x;
}

export function ease(kind: Curve, x: number): number {
  switch (kind) {
    case 'smooth':
      return easeInOutCubic(x);
    case 'linear':
      return clamp01(x);
    case 'settle':
      return settle(x);
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpRect(a: Rect, b: Rect, t: number): Rect {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];
}
