import { describe, expect, it } from 'vitest';
import type { Scene } from '@cuttle/project';
import { occurrences, rampAmount, type Occurrence } from '../src/occurrences';
import { sceneSpans } from '../src/time';

const clip = (from: number, to: number, speed = 1): Scene => ({ type: 'clip', from, to, speed });
const card: Scene = { type: 'card', title: 'End', duration: 2 };

describe('occurrences', () => {
  it('maps an overlay inside one clip to output seconds', () => {
    // clip 10–20 at 2× is output 0–5; the overlay 12–16 shows at output 1–3
    expect(occurrences(sceneSpans([clip(10, 20, 2)]), 12, 16)).toEqual([{ start: 1, end: 3, rampIn: true, rampOut: true }]);
  });

  it('joins clips over continuous cuts into one occurrence', () => {
    // 0–5 at 1× (output 0–5), 5–25 at 4× (output 5–10): the overlay 4–9 shows at output 4–6
    const shown = occurrences(sceneSpans([clip(0, 5), clip(5, 25, 4), card]), 4, 9);
    expect(shown[0]).toEqual({ start: 4, end: 6, rampIn: true, rampOut: true });
    expect(shown[1]).toBe(shown[0]);
    expect(shown[2]).toBeUndefined();
  });

  it('keeps clips apart where the source jumps, without the ramp the cut hides', () => {
    // 0–5 then 7–10: the overlay 4–9 is cut in two; neither part shows both of its ends
    const shown = occurrences(sceneSpans([clip(0, 5), clip(7, 10)]), 4, 9);
    expect(shown).toEqual([
      { start: 4, end: 5, rampIn: true, rampOut: false },
      { start: 5, end: 7, rampIn: false, rampOut: true },
    ]);
  });

  it('leaves out spans that do not show the overlay', () => {
    expect(occurrences(sceneSpans([card, clip(0, 5), clip(20, 30)]), 6, 8)).toEqual([undefined, undefined, undefined]);
  });

  it('shows a repeated stretch once per repeat', () => {
    const shown = occurrences(sceneSpans([clip(0, 5), clip(0, 5)]), 1, 2);
    expect(shown).toEqual([
      { start: 1, end: 2, rampIn: true, rampOut: true },
      { start: 6, end: 7, rampIn: true, rampOut: true },
    ]);
  });
});

describe('rampAmount', () => {
  const both: Occurrence = { start: 10, end: 14, rampIn: true, rampOut: true };

  it('ramps in and out over the ramp length', () => {
    expect(rampAmount(both, 10, 0.6, 'linear')).toBe(0);
    expect(rampAmount(both, 10.3, 0.6, 'smooth')).toBeCloseTo(0.5, 9);
    expect(rampAmount(both, 12, 0.6, 'smooth')).toBe(1);
    expect(rampAmount(both, 13.85, 0.6, 'linear')).toBeCloseTo(0.25, 9);
  });

  it('shrinks the ramps to fit a short occurrence', () => {
    // 0.4 s with both ramps: 0.2 s each
    expect(rampAmount({ start: 0, end: 0.4, rampIn: true, rampOut: true }, 0.1, 0.6, 'linear')).toBeCloseTo(0.5, 9);
    // 0.4 s with only a ramp in: all of it
    expect(rampAmount({ start: 0, end: 0.4, rampIn: true, rampOut: false }, 0.2, 0.6, 'linear')).toBeCloseTo(0.5, 9);
  });

  it('is fully in where the occurrence has no ramp', () => {
    expect(rampAmount({ start: 5, end: 7, rampIn: false, rampOut: true }, 5, 0.6, 'smooth')).toBe(1);
    expect(rampAmount({ start: 5, end: 7, rampIn: false, rampOut: false }, 7, 0.6, 'smooth')).toBe(1);
  });
});
