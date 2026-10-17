import { describe, expect, it } from 'vitest';
import type { Rect } from '@cuttle/project';
import { MAX_SIZE, MIN_SIZE, movedBubble, resizedBubble } from '../src/shared/bubble';

const HD = { width: 1920, height: 1080 };
// the default bubble's places: 194 px, 40 px from the edges
const corners = {
  'top-left': [40, 40, 194, 194],
  'top-right': [1686, 40, 194, 194],
  'bottom-left': [40, 846, 194, 194],
  'bottom-right': [1686, 846, 194, 194],
} as const satisfies Record<string, Rect>;
const cornerRect = (corner: keyof typeof corners): Rect => [...corners[corner]];
const start: Rect = [40, 846, 194, 194];

describe('moving the webcam bubble', () => {
  it('puts its centre where it is dragged, as a share of the video', () => {
    // its centre starts at (137, 943): moved to (737, 643)
    expect(movedBubble(HD, start, 600, -300, cornerRect)).toEqual({ position: { x: 0.384, y: 0.595 }, guides: {} });
  });

  it("snaps to a corner's place near one, and to the middle across or down with a guide", () => {
    expect(movedBubble(HD, start, 1640, -800, cornerRect)).toEqual({ corner: 'top-right' });
    const middle = movedBubble(HD, start, 820, -10, cornerRect);
    expect(middle).toEqual({ position: { x: 0.5, y: 0.864 }, guides: { x: 960 } });
    expect(movedBubble(HD, start, 600, -400, cornerRect)).toEqual({ position: { x: 0.384, y: 0.5 }, guides: { y: 540 } });
  });

  it('keeps it on the video', () => {
    expect(movedBubble(HD, start, -500, 900, cornerRect)).toEqual({ position: { x: 0.051, y: 0.91 }, guides: {} });
  });
});

describe('resizing the webcam bubble', () => {
  it('grows it outwards along the handle, shrinks it inwards, within its limits', () => {
    expect(resizedBubble(HD, start, 'se', 40, 40)).toBeCloseTo((194 + 40) / 1080, 3);
    expect(resizedBubble(HD, start, 'nw', 40, 40)).toBeCloseTo((194 - 40) / 1080, 3);
    expect(resizedBubble(HD, start, 'ne', 2000, -2000)).toBe(MAX_SIZE);
    expect(resizedBubble(HD, start, 'sw', 2000, -2000)).toBe(MIN_SIZE);
  });
});
